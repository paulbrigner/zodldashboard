"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AccessControlAccessLogEntry,
  AccessControlAccessLogMeta,
  AccessControlGroup,
  AccessControlGroupRole,
  AccessControlPermission,
  AccessControlRole,
  AccessControlSnapshot,
  AccessControlUser,
  EffectiveAccess,
} from "@/lib/access-control";

type AccessAdminClientProps = {
  initialSnapshot: AccessControlSnapshot;
};

const NEW_USER_VALUE = "__new_user__";
const NEW_GROUP_VALUE = "__new_group__";
const NEW_ROLE_VALUE = "__new_role__";
const ACCESS_LOG_PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const DEFAULT_ACCESS_LOG_PAGE_SIZE = 50;

type AccessAdminTab = "directory" | "users" | "groups" | "access-log";

const ACCESS_ADMIN_TABS: Array<{ id: AccessAdminTab; label: string }> = [
  { id: "directory", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "groups", label: "Groups & Roles" },
  { id: "access-log", label: "Access Log" },
];

const DASHBOARD_VIEWER_ROLE_KEY = "dashboard-viewer";
const DASHBOARD_SPECIFIC_ROLE_BY_ID: Record<string, string> = {
  "x-monitor": "xmonitor-viewer",
  "zodl-roadmap": "zodl-roadmap-viewer",
  "pgpz-roadmap": "accrediv-dashboard-viewer",
  arktouros: "arktouros-dashboard-viewer",
  placehodlr: "placehodlr-dashboard-viewer",
  "2026-zodl-summit": "zodl-summit-viewer",
};

type AdminResponse = {
  snapshot?: AccessControlSnapshot;
  preview?: EffectiveAccess;
  accessLog?: AccessControlAccessLogEntry[];
  accessLogMeta?: AccessControlAccessLogMeta;
  message?: string;
  error?: string;
};

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body?.error || `Request failed with ${response.status}`);
  }
  return body;
}

function userLabel(user: AccessControlUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name ? `${name} <${user.email}>` : user.email;
}

function userLabelForEmail(snapshot: AccessControlSnapshot, email: string): string {
  const user = snapshot.users.find((item) => item.email === email);
  return user ? userLabel(user) : email;
}

function normalizeFormEmail(value: string): string {
  return value.trim().toLowerCase();
}

function groupMemberEmails(snapshot: AccessControlSnapshot, groupKey: string): string[] {
  return snapshot.memberships.filter((membership) => membership.groupKey === groupKey).map((membership) => membership.email);
}

function userGroupKeys(snapshot: AccessControlSnapshot, email: string): string[] {
  return snapshot.memberships.filter((membership) => membership.email === email).map((membership) => membership.groupKey);
}

function userRoleAssignments(snapshot: AccessControlSnapshot, email: string) {
  const groupKeys = new Set(userGroupKeys(snapshot, email));
  return snapshot.groupRoles.filter((assignment) => groupKeys.has(assignment.groupKey));
}

function rolePermissionKeys(snapshot: AccessControlSnapshot, roleKey: string): string[] {
  return snapshot.rolePermissions.filter((item) => item.roleKey === roleKey).map((item) => item.permissionKey);
}

function groupAssignments(snapshot: AccessControlSnapshot, groupKey: string): AccessControlGroupRole[] {
  return snapshot.groupRoles.filter((assignment) => assignment.groupKey === groupKey);
}

function roleAssignments(snapshot: AccessControlSnapshot, roleKey: string): AccessControlGroupRole[] {
  return snapshot.groupRoles.filter((assignment) => assignment.roleKey === roleKey);
}

function groupLabel(snapshot: AccessControlSnapshot, groupKey: string): string {
  const group = snapshot.groups.find((item) => item.groupKey === groupKey);
  return group?.name || groupKey;
}

function roleLabel(snapshot: AccessControlSnapshot, roleKey: string): string {
  const role = snapshot.roles.find((item) => item.roleKey === roleKey);
  return role?.name || roleKey;
}

function dashboardLabel(snapshot: AccessControlSnapshot, dashboardId: string): string {
  if (dashboardId === "*" || dashboardId === "global") return "All dashboards";
  const dashboard = snapshot.dashboards.find((item) => item.id === dashboardId);
  return dashboard?.name || dashboardId;
}

function dashboardReadPermissionKey(dashboardId: string): string {
  return `dashboard:${dashboardId}:read`;
}

function permissionForKey(snapshot: AccessControlSnapshot, permissionKey: string): AccessControlPermission | null {
  return snapshot.permissions.find((permission) => permission.permissionKey === permissionKey) || null;
}

function scopeLabel(snapshot: AccessControlSnapshot, assignment: AccessControlGroupRole): string {
  if (assignment.scopeType === "global") return "Global";
  return `Dashboard: ${dashboardLabel(snapshot, assignment.scopeKey)}`;
}

type ResolvedPermissionGrant = {
  permissionKey: string;
  name: string;
  description: string | null;
};

function resolvedGrantFromPermission(
  snapshot: AccessControlSnapshot,
  assignment: AccessControlGroupRole,
  permission: AccessControlPermission
): ResolvedPermissionGrant | null {
  if (assignment.scopeType === "dashboard" && permission.resourceType === "dashboard" && permission.resourceKey === "*") {
    const scopedPermissionKey = dashboardReadPermissionKey(assignment.scopeKey);
    const scopedPermission = permissionForKey(snapshot, scopedPermissionKey);
    return {
      permissionKey: scopedPermissionKey,
      name: scopedPermission?.name || `Read ${dashboardLabel(snapshot, assignment.scopeKey)}`,
      description: scopedPermission?.description || `Granted by ${permission.name} within ${dashboardLabel(snapshot, assignment.scopeKey)}.`,
    };
  }

  if (assignment.scopeType !== "global" && permission.resourceType !== assignment.scopeType) {
    return null;
  }

  if (assignment.scopeType !== "global" && permission.resourceKey !== "*" && permission.resourceKey !== assignment.scopeKey) {
    return null;
  }

  return {
    permissionKey: permission.permissionKey,
    name: permission.name,
    description: permission.description,
  };
}

function assignmentPermissionGrants(snapshot: AccessControlSnapshot, assignment: AccessControlGroupRole): ResolvedPermissionGrant[] {
  const grants = new Map<string, ResolvedPermissionGrant>();
  for (const rolePermission of snapshot.rolePermissions.filter((item) => item.roleKey === assignment.roleKey)) {
    const permission = permissionForKey(snapshot, rolePermission.permissionKey);
    if (!permission) {
      grants.set(rolePermission.permissionKey, {
        permissionKey: rolePermission.permissionKey,
        name: rolePermission.permissionKey,
        description: null,
      });
      continue;
    }

    const resolved = resolvedGrantFromPermission(snapshot, assignment, permission);
    if (resolved) grants.set(resolved.permissionKey, resolved);
  }
  return Array.from(grants.values()).sort((a, b) => a.permissionKey.localeCompare(b.permissionKey));
}

function groupPermissionGrants(snapshot: AccessControlSnapshot, groupKey: string): ResolvedPermissionGrant[] {
  const grants = new Map<string, ResolvedPermissionGrant>();
  for (const assignment of groupAssignments(snapshot, groupKey)) {
    for (const grant of assignmentPermissionGrants(snapshot, assignment)) {
      grants.set(grant.permissionKey, grant);
    }
  }
  return Array.from(grants.values()).sort((a, b) => a.permissionKey.localeCompare(b.permissionKey));
}

function groupGrantsDashboard(snapshot: AccessControlSnapshot, groupKey: string, dashboardId: string): boolean {
  const dashboardPermission = dashboardReadPermissionKey(dashboardId);
  return groupPermissionGrants(snapshot, groupKey).some(
    (grant) => grant.permissionKey === dashboardPermission || grant.permissionKey === "dashboard:*:read"
  );
}

function assignmentGrantsDashboard(
  snapshot: AccessControlSnapshot,
  assignment: AccessControlGroupRole,
  dashboardId: string
): boolean {
  const dashboardPermission = dashboardReadPermissionKey(dashboardId);
  return assignmentPermissionGrants(snapshot, assignment).some(
    (grant) => grant.permissionKey === dashboardPermission || grant.permissionKey === "dashboard:*:read"
  );
}

function roleUsesPermission(snapshot: AccessControlSnapshot, roleKey: string, permissionKey: string): boolean {
  return snapshot.rolePermissions.some((item) => item.roleKey === roleKey && item.permissionKey === permissionKey);
}

function includesDirectoryText(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => (value || "").toLowerCase().includes(query));
}

function groupMatchesDirectoryQuery(snapshot: AccessControlSnapshot, group: AccessControlGroup, query: string): boolean {
  if (!query) return true;
  const members = groupMemberEmails(snapshot, group.groupKey);
  const assignments = groupAssignments(snapshot, group.groupKey);
  const grants = groupPermissionGrants(snapshot, group.groupKey);
  return includesDirectoryText(
    [
      group.groupKey,
      group.name,
      group.description,
      group.adminNote,
      ...members,
      ...assignments.flatMap((assignment) => [
        assignment.roleKey,
        roleLabel(snapshot, assignment.roleKey),
        assignment.scopeType,
        assignment.scopeKey,
        dashboardLabel(snapshot, assignment.scopeKey),
      ]),
      ...grants.flatMap((grant) => [grant.permissionKey, grant.name, grant.description]),
    ],
    query
  );
}

function roleMatchesDirectoryQuery(snapshot: AccessControlSnapshot, role: AccessControlRole, query: string): boolean {
  if (!query) return true;
  const assignments = roleAssignments(snapshot, role.roleKey);
  const permissionKeys = rolePermissionKeys(snapshot, role.roleKey);
  return includesDirectoryText(
    [
      role.roleKey,
      role.name,
      role.description,
      ...permissionKeys.flatMap((permissionKey) => {
        const permission = permissionForKey(snapshot, permissionKey);
        return [permissionKey, permission?.name, permission?.description];
      }),
      ...assignments.flatMap((assignment) => [
        assignment.groupKey,
        groupLabel(snapshot, assignment.groupKey),
        assignment.scopeType,
        assignment.scopeKey,
        dashboardLabel(snapshot, assignment.scopeKey),
      ]),
    ],
    query
  );
}

function permissionMatchesDirectoryQuery(snapshot: AccessControlSnapshot, permission: AccessControlPermission, query: string): boolean {
  if (!query) return true;
  const roles = snapshot.roles.filter((role) => roleUsesPermission(snapshot, role.roleKey, permission.permissionKey));
  return includesDirectoryText(
    [
      permission.permissionKey,
      permission.name,
      permission.description,
      permission.resourceType,
      permission.resourceKey,
      permission.action,
      ...roles.flatMap((role) => [role.roleKey, role.name]),
    ],
    query
  );
}

type DashboardGrantAssignment = {
  roleKey: string;
  scopeType: "global" | "dashboard";
  scopeKey: string;
};

function roleExists(snapshot: AccessControlSnapshot, roleKey: string): boolean {
  return snapshot.roles.some((role) => role.roleKey === roleKey);
}

function dashboardGrantAssignment(snapshot: AccessControlSnapshot, dashboardId: string): DashboardGrantAssignment | null {
  const specificRoleKey = DASHBOARD_SPECIFIC_ROLE_BY_ID[dashboardId];
  if (specificRoleKey && roleExists(snapshot, specificRoleKey)) {
    return { roleKey: specificRoleKey, scopeType: "global", scopeKey: "*" };
  }
  if (roleExists(snapshot, DASHBOARD_VIEWER_ROLE_KEY)) {
    return { roleKey: DASHBOARD_VIEWER_ROLE_KEY, scopeType: "dashboard", scopeKey: dashboardId };
  }
  return null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function defaultMembershipEmail(snapshot: AccessControlSnapshot): string {
  return snapshot.users.find((user) => user.status === "active")?.email || snapshot.users[0]?.email || "";
}

export function AccessAdminClient({ initialSnapshot }: AccessAdminClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedEmail, setSelectedEmail] = useState(initialSnapshot.users[0]?.email || NEW_USER_VALUE);
  const [preview, setPreview] = useState<EffectiveAccess | null>(null);
  const [accessLog, setAccessLog] = useState<AccessControlAccessLogEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AccessAdminTab>("directory");
  const [directoryQuery, setDirectoryQuery] = useState("");

  const [userEmail, setUserEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [userAdminNote, setUserAdminNote] = useState("");
  const [userStatus, setUserStatus] = useState<"active" | "inactive">("active");
  const [sendWelcome, setSendWelcome] = useState(true);
  const [pendingEmail, setPendingEmail] = useState("");

  const [selectedGroupKey, setSelectedGroupKey] = useState(initialSnapshot.groups[0]?.groupKey || NEW_GROUP_VALUE);
  const [groupKey, setGroupKey] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupAdminNote, setGroupAdminNote] = useState("");

  const [selectedRoleKey, setSelectedRoleKey] = useState(initialSnapshot.roles[0]?.roleKey || NEW_ROLE_VALUE);
  const [roleKey, setRoleKey] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");

  const [membershipMode, setMembershipMode] = useState<"select" | "email">("select");
  const [membershipEmail, setMembershipEmail] = useState(defaultMembershipEmail(initialSnapshot));
  const [membershipGroup, setMembershipGroup] = useState(initialSnapshot.groups[0]?.groupKey || "");
  const [membershipEnabled, setMembershipEnabled] = useState(true);

  const [dashboardGrantGroup, setDashboardGrantGroup] = useState(initialSnapshot.groups[0]?.groupKey || "");
  const [dashboardGrantDashboard, setDashboardGrantDashboard] = useState(initialSnapshot.dashboards[0]?.id || "");

  const [assignmentGroup, setAssignmentGroup] = useState(initialSnapshot.groups[0]?.groupKey || "");
  const [assignmentRole, setAssignmentRole] = useState(initialSnapshot.roles[0]?.roleKey || "");
  const [assignmentScopeType, setAssignmentScopeType] = useState<"global" | "dashboard">("dashboard");
  const [assignmentScopeKey, setAssignmentScopeKey] = useState(initialSnapshot.dashboards[0]?.id || "x-monitor");

  const [permissionRole, setPermissionRole] = useState(initialSnapshot.roles[0]?.roleKey || "");
  const [permissionKey, setPermissionKey] = useState(initialSnapshot.permissions[0]?.permissionKey || "");
  const [permissionEnabled, setPermissionEnabled] = useState(true);

  const [logEmail, setLogEmail] = useState("");
  const [logEventType, setLogEventType] = useState("all");
  const [logDashboardId, setLogDashboardId] = useState("all");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logPageSize, setLogPageSize] = useState(DEFAULT_ACCESS_LOG_PAGE_SIZE);
  const [logOffset, setLogOffset] = useState(0);
  const [accessLogMeta, setAccessLogMeta] = useState<AccessControlAccessLogMeta | null>(null);

  const selectedUser = useMemo(
    () => snapshot.users.find((user) => user.email === selectedEmail) || null,
    [snapshot.users, selectedEmail]
  );
  const editingNewUser = selectedEmail === NEW_USER_VALUE;
  const selectedGroup = useMemo(
    () => snapshot.groups.find((group) => group.groupKey === selectedGroupKey) || null,
    [snapshot.groups, selectedGroupKey]
  );
  const selectedRole = useMemo(
    () => snapshot.roles.find((role) => role.roleKey === selectedRoleKey) || null,
    [snapshot.roles, selectedRoleKey]
  );
  const editingNewGroup = selectedGroupKey === NEW_GROUP_VALUE;
  const editingNewRole = selectedRoleKey === NEW_ROLE_VALUE;
  const activeUsers = useMemo(() => snapshot.users.filter((user) => user.status === "active"), [snapshot.users]);
  const inactiveUsers = useMemo(() => snapshot.users.filter((user) => user.status !== "active"), [snapshot.users]);

  function clearUserForm() {
    setSelectedEmail(NEW_USER_VALUE);
    setUserEmail("");
    setFirstName("");
    setLastName("");
    setUserAdminNote("");
    setUserStatus("active");
    setPendingEmail("");
    setPreview(null);
  }

  function clearGroupForm() {
    setSelectedGroupKey(NEW_GROUP_VALUE);
    setGroupKey("");
    setGroupName("");
    setGroupDescription("");
    setGroupAdminNote("");
  }

  function clearRoleForm() {
    setSelectedRoleKey(NEW_ROLE_VALUE);
    setRoleKey("");
    setRoleName("");
    setRoleDescription("");
  }

  useEffect(() => {
    if (!selectedUser) return;
    setUserEmail(selectedUser.email);
    setFirstName(selectedUser.firstName || "");
    setLastName(selectedUser.lastName || "");
    setUserAdminNote(selectedUser.adminNote || "");
    setUserStatus(selectedUser.status);
    setPendingEmail(selectedUser.pendingEmail || "");
    setMembershipEmail(selectedUser.email);
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedGroup) return;
    setGroupKey(selectedGroup.groupKey);
    setGroupName(selectedGroup.name);
    setGroupDescription(selectedGroup.description || "");
    setGroupAdminNote(selectedGroup.adminNote || "");
  }, [selectedGroup]);

  useEffect(() => {
    if (!selectedRole) return;
    setRoleKey(selectedRole.roleKey);
    setRoleName(selectedRole.name);
    setRoleDescription(selectedRole.description || "");
  }, [selectedRole]);

  useEffect(() => {
    if (selectedGroupKey !== NEW_GROUP_VALUE && !snapshot.groups.some((group) => group.groupKey === selectedGroupKey)) {
      setSelectedGroupKey(snapshot.groups[0]?.groupKey || NEW_GROUP_VALUE);
    }
    if (!membershipGroup || !snapshot.groups.some((group) => group.groupKey === membershipGroup)) {
      setMembershipGroup(snapshot.groups[0]?.groupKey || "");
    }
    if (!dashboardGrantGroup || !snapshot.groups.some((group) => group.groupKey === dashboardGrantGroup)) {
      setDashboardGrantGroup(snapshot.groups[0]?.groupKey || "");
    }
    if (!assignmentGroup || !snapshot.groups.some((group) => group.groupKey === assignmentGroup)) {
      setAssignmentGroup(snapshot.groups[0]?.groupKey || "");
    }
  }, [assignmentGroup, dashboardGrantGroup, membershipGroup, selectedGroupKey, snapshot.groups]);

  useEffect(() => {
    if (membershipMode === "email") return;
    if (!membershipEmail || !snapshot.users.some((user) => user.email === membershipEmail)) {
      setMembershipEmail(defaultMembershipEmail(snapshot));
    }
  }, [membershipEmail, membershipMode, snapshot]);

  useEffect(() => {
    if (selectedRoleKey !== NEW_ROLE_VALUE && !snapshot.roles.some((role) => role.roleKey === selectedRoleKey)) {
      setSelectedRoleKey(snapshot.roles[0]?.roleKey || NEW_ROLE_VALUE);
    }
    if (!assignmentRole || !snapshot.roles.some((role) => role.roleKey === assignmentRole)) {
      setAssignmentRole(snapshot.roles[0]?.roleKey || "");
    }
    if (!permissionRole || !snapshot.roles.some((role) => role.roleKey === permissionRole)) {
      setPermissionRole(snapshot.roles[0]?.roleKey || "");
    }
  }, [assignmentRole, permissionRole, selectedRoleKey, snapshot.roles]);

  useEffect(() => {
    if (!permissionKey || !snapshot.permissions.some((permission) => permission.permissionKey === permissionKey)) {
      setPermissionKey(snapshot.permissions[0]?.permissionKey || "");
    }
  }, [permissionKey, snapshot.permissions]);

  useEffect(() => {
    if (!dashboardGrantDashboard || !snapshot.dashboards.some((dashboard) => dashboard.id === dashboardGrantDashboard)) {
      setDashboardGrantDashboard(snapshot.dashboards[0]?.id || "");
    }
    if (!assignmentScopeKey || !snapshot.dashboards.some((dashboard) => dashboard.id === assignmentScopeKey)) {
      setAssignmentScopeKey(snapshot.dashboards[0]?.id || "");
    }
  }, [assignmentScopeKey, dashboardGrantDashboard, snapshot.dashboards]);

  async function reloadSnapshot() {
    const response = await readJsonOrThrow<AdminResponse>(
      await fetch("/api/v1/admin/access-control", { cache: "no-store" })
    );
    if (response.snapshot) setSnapshot(response.snapshot);
  }

  async function perform(payload: Record<string, unknown>, refresh = true): Promise<AdminResponse> {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await readJsonOrThrow<AdminResponse>(
        await fetch("/api/v1/admin/access-control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      if (response.message) setNotice(response.message);
      if (refresh) await reloadSnapshot();
      return response;
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "Access admin operation failed");
      throw operationError;
    } finally {
      setLoading(false);
    }
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = normalizeFormEmail(userEmail);
    await perform({
      operation: "upsert_user",
      email,
      first_name: firstName,
      last_name: lastName,
      admin_note: userAdminNote,
      status: userStatus,
    });
    if (sendWelcome) {
      await perform({ operation: "send_welcome", email });
    }
    setSelectedEmail(email);
  }

  async function applyMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = normalizeFormEmail(membershipEmail);
    await perform({
      operation: "set_group_membership",
      email,
      group_key: membershipGroup,
      enabled: membershipEnabled,
    });
    setMembershipEmail(email);
    setSelectedEmail(email);
  }

  async function grantDashboardAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const assignment = dashboardGrantAssignment(snapshot, dashboardGrantDashboard);
    if (!assignment) {
      setError("Dashboard Viewer role is not available.");
      return;
    }
    await perform({
      operation: "assign_group_role",
      group_key: dashboardGrantGroup,
      role_key: assignment.roleKey,
      scope_type: assignment.scopeType,
      scope_key: assignment.scopeKey,
    });
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform({
      operation: "upsert_group",
      group_key: groupKey,
      name: groupName,
      description: groupDescription,
      admin_note: groupAdminNote,
    });
    setSelectedGroupKey(groupKey.trim().toLowerCase());
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform({
      operation: "upsert_role",
      role_key: roleKey,
      name: roleName,
      description: roleDescription,
    });
    setSelectedRoleKey(roleKey.trim().toLowerCase());
  }

  async function previewUser(email = selectedEmail) {
    if (!email || email === NEW_USER_VALUE) {
      setPreview(null);
      return;
    }
    const response = await perform({ operation: "preview_user", email }, false);
    setPreview(response.preview || null);
  }

  async function loadAccessLog(
    event?: FormEvent<HTMLFormElement>,
    options: { offset?: number; limit?: number } = {}
  ) {
    event?.preventDefault();
    const requestedOffset = event ? 0 : options.offset ?? logOffset;
    const requestedLimit = options.limit ?? logPageSize;
    const response = await perform(
      {
        operation: "access_log",
        email: logEmail || undefined,
        eventType: logEventType,
        dashboardId: logDashboardId,
        from: logFrom || undefined,
        to: logTo || undefined,
        limit: requestedLimit,
        offset: requestedOffset,
      },
      false
    );
    setAccessLog(response.accessLog || []);
    setAccessLogMeta(response.accessLogMeta || {
      limit: requestedLimit,
      offset: requestedOffset,
      returned: response.accessLog?.length || 0,
      hasMore: false,
      nextOffset: null,
      previousOffset: requestedOffset > 0 ? Math.max(0, requestedOffset - requestedLimit) : null,
    });
    setLogOffset(response.accessLogMeta?.offset ?? requestedOffset);
  }

  function changeLogPageSize(value: string) {
    const nextLimit = Number.parseInt(value, 10);
    const safeLimit = ACCESS_LOG_PAGE_SIZE_OPTIONS.includes(nextLimit) ? nextLimit : DEFAULT_ACCESS_LOG_PAGE_SIZE;
    setLogPageSize(safeLimit);
    void loadAccessLog(undefined, { offset: 0, limit: safeLimit });
  }

  useEffect(() => {
    if (activeTab !== "users") return;
    void previewUser(selectedEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "access-log" || accessLogMeta) return;
    void loadAccessLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, accessLogMeta]);

  const selectedGroups = !editingNewUser && selectedEmail ? userGroupKeys(snapshot, selectedEmail) : [];
  const selectedRoleAssignments = !editingNewUser && selectedEmail ? userRoleAssignments(snapshot, selectedEmail) : [];
  const selectedGroupMembers = selectedGroup ? groupMemberEmails(snapshot, selectedGroup.groupKey) : [];
  const selectedGroupAssignments = selectedGroup ? groupAssignments(snapshot, selectedGroup.groupKey) : [];
  const selectedRolePermissionKeys = !editingNewRole && selectedRoleKey ? rolePermissionKeys(snapshot, selectedRoleKey) : [];
  const selectedRoleGroupAssignments = !editingNewRole && selectedRoleKey ? roleAssignments(snapshot, selectedRoleKey) : [];
  const membershipEmailNormalized = normalizeFormEmail(membershipEmail);
  const membershipUserGroups = membershipEmailNormalized ? userGroupKeys(snapshot, membershipEmailNormalized) : [];
  const dashboardGrantGroupAssignments = dashboardGrantGroup ? groupAssignments(snapshot, dashboardGrantGroup) : [];
  const dashboardGrantGroupDashboards = dashboardGrantGroup
    ? snapshot.dashboards.filter((dashboard) => groupGrantsDashboard(snapshot, dashboardGrantGroup, dashboard.id))
    : [];
  const assignmentGroupAssignments = assignmentGroup ? groupAssignments(snapshot, assignmentGroup) : [];
  const permissionRolePermissionKeys = permissionRole ? rolePermissionKeys(snapshot, permissionRole) : [];
  const allowedDashboards = preview
    ? snapshot.dashboards.filter((dashboard) => dashboard.visible && (preview.permissions.includes(dashboard.permissionKey) || preview.permissions.includes("dashboard:*:read")))
    : [];
  const deniedDashboards = preview
    ? snapshot.dashboards.filter((dashboard) => dashboard.visible && !preview.permissions.includes(dashboard.permissionKey) && !preview.permissions.includes("dashboard:*:read"))
    : [];
  const effectiveLogOffset = accessLogMeta?.offset ?? logOffset;
  const effectiveLogLimit = accessLogMeta?.limit ?? logPageSize;
  const accessLogStart = accessLog.length ? effectiveLogOffset + 1 : 0;
  const accessLogEnd = accessLog.length ? effectiveLogOffset + accessLog.length : 0;
  const previousLogOffset = accessLogMeta?.previousOffset ?? (effectiveLogOffset > 0 ? Math.max(0, effectiveLogOffset - effectiveLogLimit) : null);
  const nextLogOffset = accessLogMeta?.nextOffset ?? null;
  const accessLogPageNumber = Math.floor(effectiveLogOffset / effectiveLogLimit) + 1;
  const directoryQueryText = directoryQuery.trim().toLowerCase();
  const directoryGroups = snapshot.groups.filter((group) => groupMatchesDirectoryQuery(snapshot, group, directoryQueryText));
  const directoryRoles = snapshot.roles.filter((role) => roleMatchesDirectoryQuery(snapshot, role, directoryQueryText));
  const directoryPermissions = snapshot.permissions.filter((permission) =>
    permissionMatchesDirectoryQuery(snapshot, permission, directoryQueryText)
  );

  return (
    <div className="access-admin-body">
      {error ? <p className="cipherpay-error-text">{error}</p> : null}
      {notice ? <p className="cipherpay-valid-text">{notice}</p> : null}

      <div className="access-admin-tabs" role="tablist" aria-label="Access admin sections">
        {ACCESS_ADMIN_TABS.map((tab) => (
          <button
            aria-controls={`access-admin-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={`access-admin-tab${activeTab === tab.id ? " access-admin-tab-active" : ""}`}
            id={`access-admin-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "users" ? (
      <section
        aria-labelledby="access-admin-tab-users"
        className="access-admin-section"
        id="access-admin-panel-users"
        role="tabpanel"
      >
        <header className="access-admin-section-header">
          <div>
            <h2>Users</h2>
            <p className="subtle-text">Create users, store admin notes, request email changes, and send welcome instructions.</p>
          </div>
          <button className="button button-secondary" disabled={loading} onClick={clearUserForm} type="button">
            New user
          </button>
        </header>

        <div className="access-admin-grid">
          <form className="access-admin-form" onSubmit={saveUser}>
            <label className="access-admin-field">
              <span>User</span>
              <select
                className="access-admin-input"
                onChange={(event) => {
                  if (event.target.value === NEW_USER_VALUE) {
                    clearUserForm();
                    return;
                  }
                  setSelectedEmail(event.target.value);
                }}
                value={selectedEmail}
              >
                <option value={NEW_USER_VALUE}>New user...</option>
                {snapshot.users.map((user) => (
                  <option key={user.email} value={user.email}>
                    {userLabel(user)}
                  </option>
                ))}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Email</span>
              <input className="access-admin-input" onChange={(event) => setUserEmail(event.target.value)} required type="email" value={userEmail} />
            </label>
            <div className="access-admin-two-col">
              <label className="access-admin-field">
                <span>First name</span>
                <input className="access-admin-input" onChange={(event) => setFirstName(event.target.value)} value={firstName} />
              </label>
              <label className="access-admin-field">
                <span>Last name</span>
                <input className="access-admin-input" onChange={(event) => setLastName(event.target.value)} value={lastName} />
              </label>
            </div>
            <label className="access-admin-field">
              <span>Status</span>
              <select className="access-admin-input" onChange={(event) => setUserStatus(event.target.value as "active" | "inactive")} value={userStatus}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="access-admin-field">
              <span>Admin note</span>
              <textarea className="access-admin-input" onChange={(event) => setUserAdminNote(event.target.value)} rows={4} value={userAdminNote} />
            </label>
            <label className="access-admin-checkbox">
              <input checked={sendWelcome} onChange={(event) => setSendWelcome(event.target.checked)} type="checkbox" />
              <span>Send welcome email after saving</span>
            </label>
            <div className="button-row">
              <button className="button" disabled={loading} type="submit">{editingNewUser ? "Create user" : "Save user"}</button>
              <button className="button button-secondary" disabled={!userEmail || loading} onClick={() => void perform({ operation: "send_welcome", email: userEmail })} type="button">
                Resend welcome
              </button>
              <button className="button button-secondary" disabled={!userEmail || loading} onClick={() => void previewUser(userEmail)} type="button">
                Preview access
              </button>
              <button className="button button-secondary" disabled={editingNewUser || !userEmail || loading} onClick={() => void perform({ operation: "delete_user", email: userEmail })} type="button">
                Delete user
              </button>
            </div>
            <div className="access-admin-two-col">
              <label className="access-admin-field">
                <span>New email</span>
                <input className="access-admin-input" onChange={(event) => setPendingEmail(event.target.value)} type="email" value={pendingEmail} />
              </label>
              <button className="button button-secondary access-admin-inline-button" disabled={!userEmail || !pendingEmail || loading} onClick={() => void perform({ operation: "request_email_change", email: userEmail, pending_email: pendingEmail })} type="button">
                Send confirmation
              </button>
            </div>
          </form>

          <div className="access-admin-panel">
            <h3>Effective Access</h3>
            {preview ? (
              <>
                <p className="access-admin-mono">{preview.email}</p>
                <p className="subtle-text">Groups: {preview.groups.join(", ") || "none"}</p>
                <p className="subtle-text">Roles: {preview.roles.join(", ") || "none"}</p>
                <div className="access-admin-preview-grid">
                  <div>
                    <h4>Allowed</h4>
                    <ul>
                      {allowedDashboards.map((dashboard) => <li key={dashboard.id}>{dashboard.name}</li>)}
                      {allowedDashboards.length === 0 ? <li>No visible dashboards</li> : null}
                    </ul>
                  </div>
                  <div>
                    <h4>Denied</h4>
                    <ul>
                      {deniedDashboards.map((dashboard) => <li key={dashboard.id}>{dashboard.name}</li>)}
                      {deniedDashboards.length === 0 ? <li>No visible dashboards</li> : null}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className="subtle-text">Select a user and preview their effective access.</p>
            )}
            <h3>Current Groups</h3>
            <p className="subtle-text">
              {selectedGroups.length
                ? selectedGroups.map((key) => `${groupLabel(snapshot, key)} (${key})`).join(", ")
                : "No group memberships"}
            </p>
            <details className="access-admin-disclosure">
              <summary>Current Role Assignments ({selectedRoleAssignments.length})</summary>
              <div className="access-admin-assignment-list">
                {selectedRoleAssignments.map((assignment) => (
                  <span className="access-admin-assignment-chip" key={assignment.assignmentId}>
                    {roleLabel(snapshot, assignment.roleKey)} via {groupLabel(snapshot, assignment.groupKey)}
                    {" "}
                    ({assignment.scopeType}:{dashboardLabel(snapshot, assignment.scopeKey)})
                  </span>
                ))}
                {selectedRoleAssignments.length === 0 ? <p className="subtle-text">No role assignments from current groups.</p> : null}
              </div>
            </details>
          </div>
        </div>
      </section>
      ) : null}

      {activeTab === "groups" ? (
      <section
        aria-labelledby="access-admin-tab-groups"
        className="access-admin-section"
        id="access-admin-panel-groups"
        role="tabpanel"
      >
        <header className="access-admin-section-header">
          <div>
            <h2>Groups & Roles</h2>
            <p className="subtle-text">
              {snapshot.groups.length} groups, {snapshot.roles.length} roles, {snapshot.permissions.length} permissions.
              Create groups/roles, assign users to groups, grant dashboard access, and manage advanced role permissions.
            </p>
          </div>
        </header>

        <div className="access-admin-grid access-admin-grid-wide">
          <form className="access-admin-form" onSubmit={saveGroup}>
            <h3>Group</h3>
            <label className="access-admin-field">
              <span>Existing group</span>
              <select
                className="access-admin-input"
                onChange={(event) => {
                  if (event.target.value === NEW_GROUP_VALUE) {
                    clearGroupForm();
                    return;
                  }
                  setSelectedGroupKey(event.target.value);
                }}
                value={selectedGroupKey}
              >
                <option value={NEW_GROUP_VALUE}>New group...</option>
                {snapshot.groups.map((group) => (
                  <option key={group.groupKey} value={group.groupKey}>
                    {group.name} ({group.memberCount} members)
                  </option>
                ))}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Group key</span>
              <input className="access-admin-input" onChange={(event) => setGroupKey(event.target.value)} placeholder="new-dashboard-guests" required value={groupKey} />
            </label>
            <label className="access-admin-field">
              <span>Name</span>
              <input className="access-admin-input" onChange={(event) => setGroupName(event.target.value)} required value={groupName} />
            </label>
            <label className="access-admin-field">
              <span>Description</span>
              <textarea className="access-admin-input" onChange={(event) => setGroupDescription(event.target.value)} rows={3} value={groupDescription} />
            </label>
            <label className="access-admin-field">
              <span>Admin note</span>
              <textarea className="access-admin-input" onChange={(event) => setGroupAdminNote(event.target.value)} rows={3} value={groupAdminNote} />
            </label>
            <details className="access-admin-disclosure">
              <summary>Group Members ({selectedGroupMembers.length})</summary>
              <div className="access-admin-assignment-list">
                {selectedGroupMembers.map((email) => (
                  <span className="access-admin-assignment-chip" key={email}>
                    {userLabelForEmail(snapshot, email)}
                  </span>
                ))}
                {!selectedGroup ? <p className="subtle-text">Select a group to view its members.</p> : null}
                {selectedGroup && selectedGroupMembers.length === 0 ? <p className="subtle-text">No users are assigned to this group.</p> : null}
              </div>
            </details>
            <details className="access-admin-disclosure">
              <summary>Group Role Assignments ({selectedGroupAssignments.length})</summary>
              <div className="access-admin-assignment-list">
                {selectedGroupAssignments.map((assignment) => (
                  <span className="access-admin-assignment-chip" key={assignment.assignmentId}>
                    {roleLabel(snapshot, assignment.roleKey)} ({scopeLabel(snapshot, assignment)})
                  </span>
                ))}
                {!selectedGroup ? <p className="subtle-text">Select a group to view its role assignments.</p> : null}
                {selectedGroup && selectedGroupAssignments.length === 0 ? <p className="subtle-text">No roles are assigned to this group.</p> : null}
              </div>
            </details>
            <div className="button-row">
              <button className="button" disabled={loading} type="submit">{editingNewGroup ? "Create group" : "Save group"}</button>
              <button className="button button-secondary" disabled={loading} onClick={clearGroupForm} type="button">
                New group
              </button>
              <button className="button button-secondary" disabled={editingNewGroup || !groupKey || loading} onClick={() => void perform({ operation: "delete_group", group_key: groupKey })} type="button">
                Delete group
              </button>
            </div>
          </form>

          <form className="access-admin-form" onSubmit={saveRole}>
            <h3>Role</h3>
            <label className="access-admin-field">
              <span>Existing role</span>
              <select
                className="access-admin-input"
                onChange={(event) => {
                  if (event.target.value === NEW_ROLE_VALUE) {
                    clearRoleForm();
                    return;
                  }
                  setSelectedRoleKey(event.target.value);
                }}
                value={selectedRoleKey}
              >
                <option value={NEW_ROLE_VALUE}>New role...</option>
                {snapshot.roles.map((role) => (
                  <option key={role.roleKey} value={role.roleKey}>
                    {role.name} ({rolePermissionKeys(snapshot, role.roleKey).length} permissions)
                  </option>
                ))}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Role key</span>
              <input className="access-admin-input" onChange={(event) => setRoleKey(event.target.value)} placeholder="dashboard-editor" required value={roleKey} />
            </label>
            <label className="access-admin-field">
              <span>Name</span>
              <input className="access-admin-input" onChange={(event) => setRoleName(event.target.value)} required value={roleName} />
            </label>
            <label className="access-admin-field">
              <span>Description</span>
              <textarea className="access-admin-input" onChange={(event) => setRoleDescription(event.target.value)} rows={3} value={roleDescription} />
            </label>
            <details className="access-admin-disclosure">
              <summary>Role Permissions ({selectedRolePermissionKeys.length})</summary>
              <div className="access-admin-assignment-list">
                {selectedRolePermissionKeys.map((item) => {
                  const permission = permissionForKey(snapshot, item);
                  return (
                    <span className="access-admin-assignment-chip" key={`${selectedRoleKey}:${item}`}>
                      {permission?.name || item}
                    </span>
                  );
                })}
                {editingNewRole ? <p className="subtle-text">Select a role to view its permissions.</p> : null}
                {!editingNewRole && selectedRolePermissionKeys.length === 0 ? <p className="subtle-text">No permissions are attached to this role.</p> : null}
              </div>
            </details>
            <details className="access-admin-disclosure">
              <summary>Assigned Groups ({selectedRoleGroupAssignments.length})</summary>
              <div className="access-admin-assignment-list">
                {selectedRoleGroupAssignments.map((assignment) => (
                  <span className="access-admin-assignment-chip" key={`${selectedRoleKey}:${assignment.assignmentId}`}>
                    {groupLabel(snapshot, assignment.groupKey)} ({scopeLabel(snapshot, assignment)})
                  </span>
                ))}
                {editingNewRole ? <p className="subtle-text">Select a role to view its group assignments.</p> : null}
                {!editingNewRole && selectedRoleGroupAssignments.length === 0 ? <p className="subtle-text">No groups use this role.</p> : null}
              </div>
            </details>
            <div className="button-row">
              <button className="button" disabled={loading} type="submit">{editingNewRole ? "Create role" : "Save role"}</button>
              <button className="button button-secondary" disabled={loading} onClick={clearRoleForm} type="button">
                New role
              </button>
              <button className="button button-secondary" disabled={editingNewRole || !roleKey || loading} onClick={() => void perform({ operation: "delete_role", role_key: roleKey })} type="button">
                Delete role
              </button>
            </div>
          </form>
        </div>

        <div className="access-admin-grid access-admin-grid-wide">
          <form className="access-admin-form" onSubmit={grantDashboardAccess}>
            <h3>Dashboard Access</h3>
            <label className="access-admin-field">
              <span>Group</span>
              <select className="access-admin-input" onChange={(event) => setDashboardGrantGroup(event.target.value)} value={dashboardGrantGroup}>
                {snapshot.groups.map((group) => <option key={group.groupKey} value={group.groupKey}>{group.name}</option>)}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Dashboard</span>
              <select className="access-admin-input" onChange={(event) => setDashboardGrantDashboard(event.target.value)} value={dashboardGrantDashboard}>
                {snapshot.dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
              </select>
            </label>
            <details className="access-admin-disclosure">
              <summary>Current Dashboard Access ({dashboardGrantGroupDashboards.length})</summary>
              <div className="access-admin-assignment-list">
                {dashboardGrantGroupDashboards.map((dashboard) => (
                  <span className="access-admin-assignment-chip" key={`${dashboardGrantGroup}:${dashboard.id}`}>
                    {dashboard.name}
                  </span>
                ))}
                {dashboardGrantGroupDashboards.length === 0 ? <p className="subtle-text">This group does not grant visible dashboard access.</p> : null}
              </div>
            </details>
            <details className="access-admin-disclosure">
              <summary>Underlying Assignments ({dashboardGrantGroupAssignments.length})</summary>
              <div className="access-admin-assignment-list">
                {dashboardGrantGroupAssignments.map((assignment) => (
                  <span className="access-admin-assignment-chip" key={`dashboard-grant:${assignment.assignmentId}`}>
                    {roleLabel(snapshot, assignment.roleKey)} ({scopeLabel(snapshot, assignment)})
                  </span>
                ))}
                {dashboardGrantGroupAssignments.length === 0 ? <p className="subtle-text">No roles are assigned to this group.</p> : null}
              </div>
            </details>
            <button className="button" disabled={!dashboardGrantGroup || !dashboardGrantDashboard || loading} type="submit">
              Grant dashboard access
            </button>
          </form>

          <form className="access-admin-form" onSubmit={applyMembership}>
            <h3>User Group Membership</h3>
            <label className="access-admin-field">
              <span>User source</span>
              <select
                className="access-admin-input"
                onChange={(event) => {
                  const nextMode = event.target.value === "email" ? "email" : "select";
                  setMembershipMode(nextMode);
                  if (nextMode === "select" && !snapshot.users.some((user) => user.email === membershipEmail)) {
                    setMembershipEmail(defaultMembershipEmail(snapshot));
                  }
                }}
                value={membershipMode}
              >
                <option value="select">Known user</option>
                <option value="email">Email entry</option>
              </select>
            </label>
            <label className="access-admin-field">
              <span>User</span>
              {membershipMode === "select" ? (
                <select
                  className="access-admin-input"
                  onChange={(event) => setMembershipEmail(event.target.value)}
                  required
                  value={membershipEmail}
                >
                  {activeUsers.length ? (
                    <optgroup label="Active users">
                      {activeUsers.map((user) => <option key={user.email} value={user.email}>{userLabel(user)}</option>)}
                    </optgroup>
                  ) : null}
                  {inactiveUsers.length ? (
                    <optgroup label="Inactive users">
                      {inactiveUsers.map((user) => <option key={user.email} value={user.email}>{userLabel(user)}</option>)}
                    </optgroup>
                  ) : null}
                </select>
              ) : (
                <>
                  <input
                    className="access-admin-input"
                    list="access-admin-membership-user-emails"
                    onChange={(event) => setMembershipEmail(event.target.value)}
                    placeholder="name@zodl.com"
                    required
                    type="email"
                    value={membershipEmail}
                  />
                  <datalist id="access-admin-membership-user-emails">
                    {snapshot.users.map((user) => <option key={user.email} label={userLabel(user)} value={user.email} />)}
                  </datalist>
                </>
              )}
            </label>
            <label className="access-admin-field">
              <span>Group</span>
              <select className="access-admin-input" onChange={(event) => setMembershipGroup(event.target.value)} value={membershipGroup}>
                {snapshot.groups.map((group) => <option key={group.groupKey} value={group.groupKey}>{group.name}</option>)}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Action</span>
              <select className="access-admin-input" onChange={(event) => setMembershipEnabled(event.target.value === "add")} value={membershipEnabled ? "add" : "remove"}>
                <option value="add">Add membership</option>
                <option value="remove">Remove membership</option>
              </select>
            </label>
            <details className="access-admin-disclosure">
              <summary>Current User Groups ({membershipUserGroups.length})</summary>
              <div className="access-admin-assignment-list">
                {membershipUserGroups.map((key) => (
                  <span className="access-admin-assignment-chip" key={`${membershipEmailNormalized}:${key}`}>
                    {groupLabel(snapshot, key)}
                  </span>
                ))}
                {membershipUserGroups.length === 0 ? <p className="subtle-text">This user is not assigned to any groups.</p> : null}
              </div>
            </details>
            <div className="button-row">
              <button className="button" disabled={!membershipEmail || !membershipGroup || loading} type="submit">Apply membership</button>
              <button
                className="button button-secondary"
                disabled={loading}
                onClick={() => {
                  clearUserForm();
                  setActiveTab("users");
                }}
                type="button"
              >
                New user
              </button>
            </div>
          </form>
        </div>

        <details className="access-admin-disclosure access-admin-advanced-controls">
          <summary>Advanced role and permission controls</summary>
          <div className="access-admin-grid access-admin-grid-wide access-admin-advanced-grid">
          <form className="access-admin-form" onSubmit={(event) => { event.preventDefault(); void perform({ operation: "assign_group_role", group_key: assignmentGroup, role_key: assignmentRole, scope_type: assignmentScopeType, scope_key: assignmentScopeKey }); }}>
            <h3>Group Role Assignment</h3>
            <label className="access-admin-field">
              <span>Group</span>
              <select className="access-admin-input" onChange={(event) => setAssignmentGroup(event.target.value)} value={assignmentGroup}>
                {snapshot.groups.map((group) => <option key={group.groupKey} value={group.groupKey}>{group.name}</option>)}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Role</span>
              <select className="access-admin-input" onChange={(event) => setAssignmentRole(event.target.value)} value={assignmentRole}>
                {snapshot.roles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.name}</option>)}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Scope</span>
              <select className="access-admin-input" onChange={(event) => setAssignmentScopeType(event.target.value as "global" | "dashboard")} value={assignmentScopeType}>
                <option value="dashboard">Dashboard</option>
                <option value="global">Global</option>
              </select>
            </label>
            {assignmentScopeType === "dashboard" ? (
              <label className="access-admin-field">
                <span>Dashboard</span>
                <select className="access-admin-input" onChange={(event) => setAssignmentScopeKey(event.target.value)} value={assignmentScopeKey}>
                  {snapshot.dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
                </select>
              </label>
            ) : null}
            <details className="access-admin-disclosure">
              <summary>Current Group Assignments ({assignmentGroupAssignments.length})</summary>
              <div className="access-admin-assignment-list">
                {assignmentGroupAssignments.map((assignment) => (
                  <span className="access-admin-assignment-chip" key={`assignment-group:${assignment.assignmentId}`}>
                    {roleLabel(snapshot, assignment.roleKey)} ({scopeLabel(snapshot, assignment)})
                  </span>
                ))}
                {assignmentGroupAssignments.length === 0 ? <p className="subtle-text">No roles are assigned to this group.</p> : null}
              </div>
            </details>
            <button className="button" disabled={loading} type="submit">Assign role</button>
          </form>

          <form className="access-admin-form" onSubmit={(event) => { event.preventDefault(); void perform({ operation: "set_role_permission", role_key: permissionRole, permission_key: permissionKey, enabled: permissionEnabled }); }}>
            <h3>Role Permission</h3>
            <label className="access-admin-field">
              <span>Role</span>
              <select className="access-admin-input" onChange={(event) => setPermissionRole(event.target.value)} value={permissionRole}>
                {snapshot.roles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.name}</option>)}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Permission</span>
              <select className="access-admin-input" onChange={(event) => setPermissionKey(event.target.value)} value={permissionKey}>
                {snapshot.permissions.map((permission) => <option key={permission.permissionKey} value={permission.permissionKey}>{permission.name}</option>)}
              </select>
            </label>
            <label className="access-admin-field">
              <span>Action</span>
              <select className="access-admin-input" onChange={(event) => setPermissionEnabled(event.target.value === "add")} value={permissionEnabled ? "add" : "remove"}>
                <option value="add">Add permission</option>
                <option value="remove">Remove permission</option>
              </select>
            </label>
            <details className="access-admin-disclosure">
              <summary>Current Role Permissions ({permissionRolePermissionKeys.length})</summary>
              <div className="access-admin-assignment-list">
                {permissionRolePermissionKeys.map((item) => {
                  const permission = permissionForKey(snapshot, item);
                  return (
                    <span className="access-admin-assignment-chip" key={`${permissionRole}:${item}`}>
                      {permission?.name || item}
                    </span>
                  );
                })}
                {permissionRolePermissionKeys.length === 0 ? <p className="subtle-text">No permissions are attached to this role.</p> : null}
              </div>
            </details>
            <button className="button" disabled={loading} type="submit">Apply permission</button>
          </form>
          </div>
        </details>
      </section>
      ) : null}

      {activeTab === "access-log" ? (
      <section
        aria-labelledby="access-admin-tab-access-log"
        className="access-admin-section"
        id="access-admin-panel-access-log"
        role="tabpanel"
      >
        <header className="access-admin-section-header">
          <div>
            <h2>User Access Log</h2>
            <p className="subtle-text">Filter user logins and dashboard access events from the auth and access audit tables.</p>
          </div>
        </header>

        <form className="access-admin-log-filters" onSubmit={loadAccessLog}>
          <label className="access-admin-field">
            <span>Email</span>
            <input className="access-admin-input" onChange={(event) => setLogEmail(event.target.value)} placeholder="all users" type="email" value={logEmail} />
          </label>
          <label className="access-admin-field">
            <span>Event</span>
            <select className="access-admin-input" onChange={(event) => setLogEventType(event.target.value)} value={logEventType}>
              <option value="all">All events</option>
              <option value="login">Logins</option>
              <option value="dashboard">Dashboard access</option>
            </select>
          </label>
          <label className="access-admin-field">
            <span>Dashboard</span>
            <select className="access-admin-input" onChange={(event) => setLogDashboardId(event.target.value)} value={logDashboardId}>
              <option value="all">All dashboards</option>
              {snapshot.dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
            </select>
          </label>
          <label className="access-admin-field">
            <span>From</span>
            <input className="access-admin-input" onChange={(event) => setLogFrom(event.target.value)} type="datetime-local" value={logFrom} />
          </label>
          <label className="access-admin-field">
            <span>To</span>
            <input className="access-admin-input" onChange={(event) => setLogTo(event.target.value)} type="datetime-local" value={logTo} />
          </label>
          <label className="access-admin-field">
            <span>Rows</span>
            <select className="access-admin-input" onChange={(event) => changeLogPageSize(event.target.value)} value={logPageSize}>
              {ACCESS_LOG_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="button access-admin-inline-button" disabled={loading} type="submit">Filter log</button>
        </form>

        <div className="access-admin-table-wrap">
          <table className="access-admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Event</th>
                <th>Dashboard</th>
                <th>Outcome</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {accessLog.map((entry) => (
                <tr key={entry.eventId}>
                  <td>{formatDateTime(entry.occurredAt)}</td>
                  <td className="access-admin-mono">{entry.email}</td>
                  <td>{entry.eventType === "login" ? `Login (${entry.provider || entry.authMode})` : "Dashboard"}</td>
                  <td>{entry.dashboardName || entry.path || "n/a"}</td>
                  <td>{entry.outcome || entry.statusCode || "n/a"}</td>
                  <td>{entry.accessLevel}</td>
                </tr>
              ))}
              {accessLog.length === 0 ? (
                <tr>
                  <td colSpan={6}>No matching access events.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="access-admin-pagination" aria-label="User access log pagination">
          <p className="subtle-text">
            {accessLog.length
              ? `Page ${accessLogPageNumber}: showing ${accessLogStart}-${accessLogEnd}${accessLogMeta?.hasMore ? ", more available" : ""}.`
              : "No access log rows on this page."}
          </p>
          <div className="button-row">
            <button
              className="button button-secondary button-small"
              disabled={loading || previousLogOffset === null}
              onClick={() => previousLogOffset !== null && void loadAccessLog(undefined, { offset: previousLogOffset })}
              type="button"
            >
              Previous
            </button>
            <button
              className="button button-secondary button-small"
              disabled={loading || nextLogOffset === null}
              onClick={() => nextLogOffset !== null && void loadAccessLog(undefined, { offset: nextLogOffset })}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      </section>
      ) : null}

      {activeTab === "directory" ? (
      <section
        aria-labelledby="access-admin-tab-directory"
        className="access-admin-section"
        id="access-admin-panel-directory"
        role="tabpanel"
      >
        <header className="access-admin-section-header">
          <div>
            <h2>Access Overview</h2>
            <p className="subtle-text">Inspect dashboard coverage, group grants, role permissions, and permission usage.</p>
          </div>
          <label className="access-admin-field access-admin-directory-search">
            <span>Search directory</span>
            <input
              className="access-admin-input"
              onChange={(event) => setDirectoryQuery(event.target.value)}
              placeholder="group, role, user, dashboard, or permission"
              type="search"
              value={directoryQuery}
            />
          </label>
        </header>

        <div className="access-admin-stat-grid" aria-label="Access-control directory totals">
          <div className="access-admin-stat">
            <strong>{snapshot.users.length}</strong>
            <span>Users</span>
          </div>
          <div className="access-admin-stat">
            <strong>{snapshot.groups.length}</strong>
            <span>Groups</span>
          </div>
          <div className="access-admin-stat">
            <strong>{snapshot.roles.length}</strong>
            <span>Roles</span>
          </div>
          <div className="access-admin-stat">
            <strong>{snapshot.groupRoles.length}</strong>
            <span>Group-role assignments</span>
          </div>
          <div className="access-admin-stat">
            <strong>{snapshot.permissions.length}</strong>
            <span>Permissions</span>
          </div>
        </div>

        <div className="access-admin-subsection">
          <h3>Dashboard Access Matrix</h3>
          <div className="access-admin-table-wrap">
            <table className="access-admin-table">
              <thead>
                <tr>
                  <th>Dashboard</th>
                  <th>Permission</th>
                  <th>Groups granting access</th>
                  <th>Assigned users</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.dashboards.map((dashboard) => {
                  const grantingGroups = snapshot.groups.filter((group) => groupGrantsDashboard(snapshot, group.groupKey, dashboard.id));
                  const assignedUsers = Array.from(
                    new Set(grantingGroups.flatMap((group) => groupMemberEmails(snapshot, group.groupKey)))
                  ).sort();
                  return (
                    <tr key={dashboard.id}>
                      <td>
                        <strong>{dashboard.name}</strong>
                        <p className="access-admin-mono">
                          {dashboard.id}{dashboard.visible ? "" : " - hidden"}
                        </p>
                      </td>
                      <td>
                        <p className="access-admin-mono">{dashboard.permissionKey}</p>
                      </td>
                      <td>
                        {grantingGroups.length ? (
                          <div className="access-admin-stack">
                            {grantingGroups.map((group) => {
                              const dashboardAssignments = groupAssignments(snapshot, group.groupKey).filter((assignment) =>
                                assignmentGrantsDashboard(snapshot, assignment, dashboard.id)
                              );
                              return (
                                <div className="access-admin-directory-line" key={`${dashboard.id}:${group.groupKey}`}>
                                  <strong>{group.name}</strong>
                                  <p className="access-admin-mono">{group.groupKey}</p>
                                  <p className="subtle-text">
                                    {dashboardAssignments.map((assignment) => `${roleLabel(snapshot, assignment.roleKey)} - ${scopeLabel(snapshot, assignment)}`).join("; ")}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="subtle-text">No group grants this dashboard.</span>
                        )}
                      </td>
                      <td>
                        {assignedUsers.length ? (
                          <details className="access-admin-plain-details" open={assignedUsers.length <= 8}>
                            <summary>{assignedUsers.length} assigned user{assignedUsers.length === 1 ? "" : "s"}</summary>
                            <div className="access-admin-assignment-list">
                              {assignedUsers.map((email) => (
                                <span className="access-admin-assignment-chip" key={`${dashboard.id}:${email}`}>
                                  {userLabelForEmail(snapshot, email)}
                                </span>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <span className="subtle-text">No users assigned.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="access-admin-subsection">
          <h3>Group Grants</h3>
          <div className="access-admin-table-wrap">
            <table className="access-admin-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Members</th>
                  <th>Role assignments and resolved permissions</th>
                  <th>Admin note</th>
                </tr>
              </thead>
              <tbody>
                {directoryGroups.map((group: AccessControlGroup) => {
                  const members = groupMemberEmails(snapshot, group.groupKey);
                  const assignments = groupAssignments(snapshot, group.groupKey);
                  return (
                    <tr key={group.groupKey}>
                      <td>
                        <strong>{group.name}</strong>
                        <p className="access-admin-mono">{group.groupKey}</p>
                        {group.description ? <p className="subtle-text">{group.description}</p> : null}
                        <p className="subtle-text">{group.isSystem ? "System group" : "Custom group"}</p>
                      </td>
                      <td>
                        {members.length ? (
                          <details className="access-admin-plain-details" open={members.length <= 8}>
                            <summary>{members.length} member{members.length === 1 ? "" : "s"}</summary>
                            <div className="access-admin-assignment-list">
                              {members.map((email) => (
                                <span className="access-admin-assignment-chip" key={`${group.groupKey}:${email}`}>
                                  {userLabelForEmail(snapshot, email)}
                                </span>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <span className="subtle-text">No members.</span>
                        )}
                      </td>
                      <td>
                        {assignments.length ? (
                          <div className="access-admin-grant-list">
                            {assignments.map((assignment) => {
                              const grants = assignmentPermissionGrants(snapshot, assignment);
                              const role = snapshot.roles.find((item) => item.roleKey === assignment.roleKey);
                              return (
                                <details className="access-admin-grant-detail" key={assignment.assignmentId} open>
                                  <summary>
                                    <strong>{roleLabel(snapshot, assignment.roleKey)}</strong>
                                    <span>{scopeLabel(snapshot, assignment)}</span>
                                  </summary>
                                  {role?.description ? <p className="subtle-text">{role.description}</p> : null}
                                  {grants.length ? (
                                    <div className="access-admin-permission-list">
                                      {grants.map((grant) => (
                                        <span className="access-admin-permission-chip" key={`${assignment.assignmentId}:${grant.permissionKey}`}>
                                          <strong>{grant.name}</strong>
                                          <span className="access-admin-mono">{grant.permissionKey}</span>
                                          {grant.description ? <span>{grant.description}</span> : null}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="subtle-text">This assignment does not resolve to permissions in its current scope.</p>
                                  )}
                                  <button
                                    className="button button-secondary button-small"
                                    disabled={loading}
                                    onClick={() => void perform({ operation: "remove_group_role", assignment_id: assignment.assignmentId })}
                                    type="button"
                                  >
                                    Remove assignment
                                  </button>
                                </details>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="subtle-text">No role assignments.</span>
                        )}
                      </td>
                      <td>{group.adminNote || "n/a"}</td>
                    </tr>
                  );
                })}
                {directoryGroups.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No groups match the current directory search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="access-admin-subsection">
          <h3>Roles</h3>
          <div className="access-admin-table-wrap">
            <table className="access-admin-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Permissions on role</th>
                  <th>Assigned to groups</th>
                </tr>
              </thead>
              <tbody>
                {directoryRoles.map((role) => {
                  const permissionKeys = rolePermissionKeys(snapshot, role.roleKey);
                  const assignments = roleAssignments(snapshot, role.roleKey);
                  return (
                    <tr key={role.roleKey}>
                      <td>
                        <strong>{role.name}</strong>
                        <p className="access-admin-mono">{role.roleKey}</p>
                        {role.description ? <p className="subtle-text">{role.description}</p> : null}
                        <p className="subtle-text">{role.isSystem ? "System role" : "Custom role"}</p>
                      </td>
                      <td>
                        {permissionKeys.length ? (
                          <div className="access-admin-permission-list">
                            {permissionKeys.map((item) => {
                              const permission = permissionForKey(snapshot, item);
                              return (
                                <span className="access-admin-permission-chip" key={`${role.roleKey}:${item}`}>
                                  <strong>{permission?.name || item}</strong>
                                  <span className="access-admin-mono">{item}</span>
                                  {permission?.description ? <span>{permission.description}</span> : null}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="subtle-text">No permissions.</span>
                        )}
                      </td>
                      <td>
                        {assignments.length ? (
                          <div className="access-admin-stack">
                            {assignments.map((assignment) => (
                              <div className="access-admin-directory-line" key={`${role.roleKey}:${assignment.assignmentId}`}>
                                <strong>{groupLabel(snapshot, assignment.groupKey)}</strong>
                                <p className="access-admin-mono">{assignment.groupKey}</p>
                                <p className="subtle-text">{scopeLabel(snapshot, assignment)}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="subtle-text">Not assigned to any group.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {directoryRoles.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No roles match the current directory search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="access-admin-subsection">
          <h3>Permission Catalog</h3>
          <div className="access-admin-table-wrap">
            <table className="access-admin-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>Resource</th>
                  <th>Used by roles</th>
                </tr>
              </thead>
              <tbody>
                {directoryPermissions.map((permission) => {
                  const rolesUsingPermission = snapshot.roles.filter((role) =>
                    roleUsesPermission(snapshot, role.roleKey, permission.permissionKey)
                  );
                  return (
                    <tr key={permission.permissionKey}>
                      <td>
                        <strong>{permission.name}</strong>
                        <p className="access-admin-mono">{permission.permissionKey}</p>
                        {permission.description ? <p className="subtle-text">{permission.description}</p> : null}
                      </td>
                      <td>
                        <p className="access-admin-mono">
                          {permission.resourceType}:{permission.resourceKey}:{permission.action}
                        </p>
                        <p className="subtle-text">{permission.isSystem ? "System permission" : "Custom permission"}</p>
                      </td>
                      <td>
                        {rolesUsingPermission.length ? (
                          <div className="access-admin-assignment-list">
                            {rolesUsingPermission.map((role) => (
                              <span className="access-admin-assignment-chip" key={`${permission.permissionKey}:${role.roleKey}`}>
                                {role.name} ({role.roleKey})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="subtle-text">No roles use this permission.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {directoryPermissions.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No permissions match the current directory search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      ) : null}
    </div>
  );
}
