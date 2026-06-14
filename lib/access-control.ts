import { createHash, randomBytes } from "node:crypto";
import { getDbPool } from "@/lib/xmonitor/db";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";
import {
  allowedAccredivGuestEmails,
  allowedArktourosGuestEmails,
  allowedGuestEmails,
  allowedXMonitorGuestEmails,
  allowedZodlSummitGuestEmails,
  guestAccessLevelForEmail,
  normalizeEmail,
  parseEmailAllowlist,
  type AuthLoginAccessLevel,
  type ViewerAccessLevel,
} from "@/lib/viewer-access";

export const ACCESS_ADMIN_PERMISSION = "admin:access-control:manage";
export const IMPERSONATE_PERMISSION = "admin:access-control:impersonate";
const DEFAULT_ACCESS_CONTROL_TIMEOUT_MS = 5000;

export type AccessControlUserStatus = "active" | "inactive";
export type AccessControlInvitationKind = "welcome" | "email-change";
export type AccessControlInvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type AccessControlScopeType = "global" | "dashboard";

export type AccessControlDashboardResource = {
  id: string;
  name: string;
  permissionKey: string;
  visible: boolean;
};

export type EffectiveAccess = {
  email: string;
  accessLevel: ViewerAccessLevel;
  status: AccessControlUserStatus;
  groups: string[];
  roles: string[];
  permissions: string[];
  source: "access-control" | "legacy-env" | "local-bypass";
};

export type AccessControlUser = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  adminNote: string | null;
  status: AccessControlUserStatus;
  pendingEmail: string | null;
  emailConfirmedAt: string | null;
  emailChangeRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccessControlGroup = {
  groupKey: string;
  name: string;
  description: string | null;
  adminNote: string | null;
  isSystem: boolean;
  memberCount: number;
};

export type AccessControlRole = {
  roleKey: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};

export type AccessControlPermission = {
  permissionKey: string;
  resourceType: string;
  resourceKey: string;
  action: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};

export type AccessControlMembership = {
  groupKey: string;
  email: string;
  expiresAt: string | null;
  createdAt: string;
};

export type AccessControlGroupRole = {
  assignmentId: string;
  groupKey: string;
  roleKey: string;
  scopeType: AccessControlScopeType;
  scopeKey: string;
  createdAt: string;
};

export type AccessControlRolePermission = {
  roleKey: string;
  permissionKey: string;
  createdAt: string;
};

export type AccessControlInvitation = {
  invitationId: string;
  email: string;
  previousEmail: string | null;
  kind: AccessControlInvitationKind;
  status: AccessControlInvitationStatus;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  welcomeEmailSentAt: string | null;
  errorMessage: string | null;
};

export type AccessControlSnapshot = {
  actor: EffectiveAccess;
  users: AccessControlUser[];
  groups: AccessControlGroup[];
  roles: AccessControlRole[];
  permissions: AccessControlPermission[];
  memberships: AccessControlMembership[];
  groupRoles: AccessControlGroupRole[];
  rolePermissions: AccessControlRolePermission[];
  invitations: AccessControlInvitation[];
  dashboards: AccessControlDashboardResource[];
};

export type AccessControlAccessLogEntry = {
  eventId: string;
  eventType: "login" | "dashboard";
  email: string;
  provider: string | null;
  authMode: string;
  accessLevel: string;
  dashboardId: string | null;
  dashboardName: string | null;
  path: string | null;
  outcome: string | null;
  statusCode: number | null;
  occurredAt: string;
};

export type AccessControlAccessLogMeta = {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
  previousOffset: number | null;
};

export type AccessControlAccessLogFilters = {
  email?: string;
  eventType?: "all" | "login" | "dashboard";
  dashboardId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type AccessControlOperationResult = {
  snapshot?: AccessControlSnapshot;
  preview?: EffectiveAccess;
  invitation?: AccessControlInvitation;
  accessLog?: AccessControlAccessLogEntry[];
  accessLogMeta?: AccessControlAccessLogMeta;
  message?: string;
};

type AccessControlOperation =
  | { operation: "upsert_user"; email: string; first_name?: string; last_name?: string; admin_note?: string; status?: AccessControlUserStatus }
  | { operation: "delete_user"; email: string }
  | { operation: "request_email_change"; email: string; pending_email: string; app_base_url?: string }
  | { operation: "send_welcome"; email: string; app_base_url?: string }
  | { operation: "upsert_group"; group_key: string; name: string; description?: string; admin_note?: string }
  | { operation: "delete_group"; group_key: string }
  | { operation: "upsert_role"; role_key: string; name: string; description?: string }
  | { operation: "delete_role"; role_key: string }
  | { operation: "set_group_membership"; group_key: string; email: string; enabled: boolean; expires_at?: string | null }
  | { operation: "set_role_permission"; role_key: string; permission_key: string; enabled: boolean }
  | { operation: "assign_group_role"; group_key: string; role_key: string; scope_type?: AccessControlScopeType; scope_key?: string }
  | { operation: "remove_group_role"; assignment_id: string }
  | { operation: "preview_user"; email: string }
  | ({ operation: "access_log" } & AccessControlAccessLogFilters);

type PermissionRow = {
  group_key: string;
  role_key: string;
  permission_key: string;
  resource_type: string;
  resource_key: string;
  action: string;
  scope_type: AccessControlScopeType;
  scope_key: string;
};

const PRIVATE_DASHBOARD_IDS = ["zodl-roadmap", "pgpz-roadmap", "arktouros", "2026-zodl-summit"];

export const accessControlDashboards: AccessControlDashboardResource[] = [
  { id: "x-monitor", name: "X Monitor", permissionKey: dashboardReadPermission("x-monitor"), visible: true },
  { id: "zodl-roadmap", name: "Zodl Roadmap", permissionKey: dashboardReadPermission("zodl-roadmap"), visible: true },
  {
    id: "pgpz-roadmap",
    name: "Accrediv Updates & PGPZ Status",
    permissionKey: dashboardReadPermission("pgpz-roadmap"),
    visible: true,
  },
  { id: "arktouros", name: "Arktouros & U.S. Regulatory", permissionKey: dashboardReadPermission("arktouros"), visible: true },
  { id: "2026-zodl-summit", name: "Zodl Summit", permissionKey: dashboardReadPermission("2026-zodl-summit"), visible: true },
  { id: "cipherpay-test", name: "CipherPay Test", permissionKey: dashboardReadPermission("cipherpay-test"), visible: false },
  { id: "regulatory-risk", name: "Regulatory Risk by Geography", permissionKey: dashboardReadPermission("regulatory-risk"), visible: false },
  {
    id: "app-store-compliance",
    name: "App Store Dashboard",
    permissionKey: dashboardReadPermission("app-store-compliance"),
    visible: false,
  },
];

function allowedGoogleDomain(): string {
  return (process.env.ALLOWED_GOOGLE_DOMAIN || "zodl.com").trim().toLowerCase().replace(/^@+/, "");
}

function isWorkspaceEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex > 0 && atIndex < normalized.length - 1 && normalized.slice(atIndex + 1) === allowedGoogleDomain();
}

function bootstrapAdminEmails(): Set<string> {
  return parseEmailAllowlist(process.env.ACCESS_BOOTSTRAP_ADMIN_EMAILS || "paul@zodl.com");
}

function configuredAccessEmails(): Set<string> {
  return new Set([
    ...bootstrapAdminEmails(),
    ...allowedXMonitorGuestEmails(),
    ...allowedAccredivGuestEmails(),
    ...allowedArktourosGuestEmails(),
    ...allowedZodlSummitGuestEmails(),
  ]);
}

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function accessControlTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.ACCESS_CONTROL_BACKEND_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ACCESS_CONTROL_TIMEOUT_MS;
}

function assertKey(value: unknown, label: string): string {
  const key = normalizeKey(value);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    throw new Error(`${label} must use lowercase letters, numbers, and hyphens`);
  }
  return key;
}

function assertPermissionKey(value: unknown): string {
  const key = normalizeKey(value);
  if (!/^[a-z0-9:*._-]+$/.test(key)) {
    throw new Error("permission_key is invalid");
  }
  return key;
}

function assertEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("email is invalid");
  }
  return email;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function invitationTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function dashboardReadPermission(dashboardId: string): string {
  return `dashboard:${dashboardId}:read`;
}

export function hasAccessPermission(access: Pick<EffectiveAccess, "permissions">, permissionKey: string): boolean {
  if (access.permissions.includes(permissionKey)) return true;
  return permissionKey.startsWith("dashboard:") && permissionKey.endsWith(":read") && access.permissions.includes("dashboard:*:read");
}

export function canReadDashboard(access: Pick<EffectiveAccess, "permissions" | "accessLevel">, dashboardId: string): boolean {
  if (access.accessLevel === "local-bypass") return true;
  return hasAccessPermission(access, dashboardReadPermission(dashboardId));
}

function accessLevelFromPermissions(email: string, permissions: string[]): AuthLoginAccessLevel {
  if (isWorkspaceEmail(email)) return "workspace";
  return permissions.includes("dashboard:*:read") ||
    permissions.some((permission) => PRIVATE_DASHBOARD_IDS.some((id) => permission === dashboardReadPermission(id)))
    ? "roadmap-guest"
    : "guest";
}

function legacyEffectiveAccess(email: string): EffectiveAccess {
  const normalizedEmail = normalizeEmail(email);
  const permissions = [dashboardReadPermission("x-monitor")];
  if (isWorkspaceEmail(normalizedEmail)) {
    for (const dashboard of accessControlDashboards) {
      permissions.push(dashboard.permissionKey);
    }
    return {
      email: normalizedEmail,
      accessLevel: "workspace",
      status: "active",
      groups: ["workspace-members"],
      roles: ["dashboard-viewer"],
      permissions: Array.from(new Set(permissions)),
      source: "legacy-env",
    };
  }

  const guestLevel = guestAccessLevelForEmail(normalizedEmail);
  if (guestLevel === "roadmap-guest") {
    for (const dashboardId of PRIVATE_DASHBOARD_IDS) {
      permissions.push(dashboardReadPermission(dashboardId));
    }
  }
  return {
    email: normalizedEmail,
    accessLevel: guestLevel,
    status: allowedGuestEmails().has(normalizedEmail) ? "active" : "inactive",
    groups: guestLevel === "roadmap-guest" ? ["private-dashboard-guests"] : ["xmonitor-guests"],
    roles: ["dashboard-viewer"],
    permissions: Array.from(new Set(permissions)),
    source: "legacy-env",
  };
}

export function localBypassEffectiveAccess(email: string): EffectiveAccess {
  return {
    email: normalizeEmail(email),
    accessLevel: "local-bypass",
    status: "active",
    groups: ["local-bypass"],
    roles: ["dashboard-viewer"],
    permissions: accessControlDashboards.map((dashboard) => dashboard.permissionKey),
    source: "local-bypass",
  };
}

async function recordAudit(
  actorEmail: string,
  action: string,
  targetType: string,
  targetKey: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await getDbPool().query(
    `
      INSERT INTO auth_admin_audit_events(actor_email, action, target_type, target_key, before_json, after_json)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    `,
    [actorEmail, action, targetType, targetKey, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

async function tableExists(tableName: string): Promise<boolean> {
  if (!hasDatabaseConfig()) return false;
  const result = await getDbPool().query("SELECT to_regclass($1) AS table_name", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_name);
}

export async function hasAccessControlSchema(): Promise<boolean> {
  return tableExists("auth_subjects");
}

async function upsertSubject(email: string, actorEmail: string | null = null): Promise<void> {
  await getDbPool().query(
    `
      INSERT INTO auth_subjects(email, status, created_by, updated_by)
      VALUES ($1, 'active', $2, $2)
      ON CONFLICT (email) DO UPDATE
      SET updated_by = COALESCE(EXCLUDED.updated_by, auth_subjects.updated_by)
    `,
    [email, actorEmail]
  );
}

async function upsertMembership(groupKey: string, email: string, actorEmail: string | null = null): Promise<void> {
  await upsertSubject(email, actorEmail);
  await getDbPool().query(
    `
      INSERT INTO auth_group_memberships(group_key, email, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (group_key, email) DO NOTHING
    `,
    [groupKey, email, actorEmail]
  );
}

async function seedEnvMembershipsForEmail(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  if (bootstrapAdminEmails().has(normalizedEmail)) {
    await upsertMembership("admins", normalizedEmail, "bootstrap");
  }

  if (isWorkspaceEmail(normalizedEmail)) {
    await upsertMembership("workspace-members", normalizedEmail, "workspace-domain");
  }

  if (allowedXMonitorGuestEmails().has(normalizedEmail)) {
    await upsertMembership("xmonitor-guests", normalizedEmail, "legacy-env");
  }

  if (allowedAccredivGuestEmails().has(normalizedEmail)) {
    await upsertMembership("accrediv-guests", normalizedEmail, "legacy-env");
  }

  if (allowedArktourosGuestEmails().has(normalizedEmail)) {
    await upsertMembership("arktouros-guests", normalizedEmail, "legacy-env");
  }

  if (allowedZodlSummitGuestEmails().has(normalizedEmail)) {
    await upsertMembership("2026-zodl-summit-guests", normalizedEmail, "legacy-env");
  }
}

async function seedConfiguredEnvMemberships(): Promise<void> {
  for (const email of configuredAccessEmails()) {
    await seedEnvMembershipsForEmail(email);
  }
}

async function seedWorkspaceLoginMemberships(): Promise<void> {
  if (!(await tableExists("auth_login_events"))) return;

  const result = await getDbPool().query(
    `
      SELECT DISTINCT lower(email::text) AS email
      FROM auth_login_events
      WHERE access_level = 'workspace'
        AND split_part(lower(email::text), '@', 2) = $1
      ORDER BY email
      LIMIT 1000
    `,
    [allowedGoogleDomain()]
  );

  for (const row of result.rows) {
    await seedEnvMembershipsForEmail(row.email);
  }
}

async function seedAccessDirectoryMemberships(): Promise<void> {
  await seedConfiguredEnvMemberships();
  await seedWorkspaceLoginMemberships();
}

function permissionFromRow(row: PermissionRow): string | null {
  if (row.scope_type === "dashboard" && row.resource_type === "dashboard" && row.resource_key === "*") {
    return dashboardReadPermission(row.scope_key);
  }
  if (row.scope_type !== "global" && row.resource_type !== row.scope_type) {
    return null;
  }
  if (row.scope_type !== "global" && row.resource_key !== "*" && row.resource_key !== row.scope_key) {
    return null;
  }
  return row.permission_key;
}

async function resolveDirectEffectiveAccess(email: string): Promise<EffectiveAccess> {
  const normalizedEmail = assertEmail(email);
  if (!(await hasAccessControlSchema())) {
    return legacyEffectiveAccess(normalizedEmail);
  }

  await seedEnvMembershipsForEmail(normalizedEmail);

  const subject = await getDbPool().query(
    `
      SELECT email, status
      FROM auth_subjects
      WHERE email = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );

  const status = (subject.rows[0]?.status || (allowedGuestEmails().has(normalizedEmail) || isWorkspaceEmail(normalizedEmail) ? "active" : "inactive")) as AccessControlUserStatus;

  if (status !== "active") {
    return {
      ...legacyEffectiveAccess(normalizedEmail),
      status,
      permissions: [],
      source: "access-control",
    };
  }

  const result = await getDbPool().query<PermissionRow>(
    `
      SELECT
        gm.group_key,
        gr.role_key,
        rp.permission_key,
        p.resource_type,
        p.resource_key,
        p.action,
        gr.scope_type,
        gr.scope_key
      FROM auth_group_memberships gm
      JOIN auth_group_roles gr ON gr.group_key = gm.group_key
      JOIN auth_role_permissions rp ON rp.role_key = gr.role_key
      JOIN auth_permissions p ON p.permission_key = rp.permission_key
      WHERE gm.email = $1
        AND (gm.expires_at IS NULL OR gm.expires_at > now())
    `,
    [normalizedEmail]
  );

  const groups = new Set<string>();
  const roles = new Set<string>();
  const permissions = new Set<string>();

  for (const row of result.rows) {
    groups.add(row.group_key);
    roles.add(row.role_key);
    const permission = permissionFromRow(row);
    if (permission) permissions.add(permission);
  }

  if (isWorkspaceEmail(normalizedEmail)) {
    groups.add("workspace-members");
  }

  const permissionList = Array.from(permissions).sort();
  return {
    email: normalizedEmail,
    accessLevel: accessLevelFromPermissions(normalizedEmail, permissionList),
    status,
    groups: Array.from(groups).sort(),
    roles: Array.from(roles).sort(),
    permissions: permissionList,
    source: "access-control",
  };
}

async function resolveViaBackend(email: string): Promise<EffectiveAccess | null> {
  const backendBase = backendApiBaseUrl();
  const viewerHeaders = buildViewerProxyHeaders({ email, authMode: "oauth" });
  if (!backendBase || !viewerHeaders) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), accessControlTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${backendBase}/auth/access-control/effective-access`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...viewerHeaders,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) return null;
  const body = (await response.json()) as { access?: EffectiveAccess };
  return body.access ?? null;
}

export async function resolveEffectiveAccess(email: string): Promise<EffectiveAccess> {
  const normalizedEmail = assertEmail(email);
  try {
    const backend = await resolveViaBackend(normalizedEmail);
    if (backend) return backend;
  } catch (error) {
    console.warn(`[access-control] backend effective-access fallback email=${normalizedEmail} reason=${error instanceof Error ? error.message : "unknown"}`);
  }

  try {
    if (hasDatabaseConfig()) {
      return await resolveDirectEffectiveAccess(normalizedEmail);
    }
  } catch (error) {
    console.warn(`[access-control] direct effective-access fallback email=${normalizedEmail} reason=${error instanceof Error ? error.message : "unknown"}`);
  }

  return legacyEffectiveAccess(normalizedEmail);
}

export async function canAuthenticateWithAccessControl(email: string): Promise<boolean> {
  const access = await resolveEffectiveAccess(email);
  return access.status === "active" && (access.permissions.length > 0 || hasAccessPermission(access, ACCESS_ADMIN_PERMISSION));
}

export function requireManageAccessPermission(access: Pick<EffectiveAccess, "permissions">): void {
  if (!hasAccessPermission(access, ACCESS_ADMIN_PERMISSION)) {
    throw new Error("access-control admin permission required");
  }
}

async function directSnapshot(actorEmail: string): Promise<AccessControlSnapshot> {
  if (!(await hasAccessControlSchema())) {
    throw new Error("access-control schema is not installed. Run npm run db:migrate.");
  }

  const actor = await resolveDirectEffectiveAccess(actorEmail);
  requireManageAccessPermission(actor);
  await seedAccessDirectoryMemberships();

  const [users, groups, roles, permissions, memberships, groupRoles, rolePermissions, invitations] = await Promise.all([
    getDbPool().query(
      `
        SELECT email, first_name, last_name, admin_note, status, pending_email, email_confirmed_at, email_change_requested_at, created_at, updated_at
        FROM auth_subjects
        ORDER BY email
      `
    ),
    getDbPool().query(
      `
        SELECT g.group_key, g.name, g.description, g.admin_note, g.is_system, COUNT(gm.email)::int AS member_count
        FROM auth_groups g
        LEFT JOIN auth_group_memberships gm ON gm.group_key = g.group_key
        GROUP BY g.group_key, g.name, g.description, g.is_system
        ORDER BY g.is_system DESC, g.name
      `
    ),
    getDbPool().query(
      `
        SELECT role_key, name, description, is_system
        FROM auth_roles
        ORDER BY is_system DESC, name
      `
    ),
    getDbPool().query(
      `
        SELECT permission_key, resource_type, resource_key, action, name, description, is_system
        FROM auth_permissions
        ORDER BY resource_type, resource_key, action
      `
    ),
    getDbPool().query(
      `
        SELECT group_key, email, expires_at, created_at
        FROM auth_group_memberships
        ORDER BY group_key, email
      `
    ),
    getDbPool().query(
      `
        SELECT assignment_id, group_key, role_key, scope_type, scope_key, created_at
        FROM auth_group_roles
        ORDER BY group_key, role_key, scope_type, scope_key
      `
    ),
    getDbPool().query(
      `
        SELECT role_key, permission_key, created_at
        FROM auth_role_permissions
        ORDER BY role_key, permission_key
      `
    ),
    getDbPool().query(
      `
        SELECT invitation_id, email, previous_email, kind, status, invited_by, invited_at, expires_at, accepted_at, welcome_email_sent_at, error_message
        FROM auth_invitations
        ORDER BY invited_at DESC
        LIMIT 100
      `
    ),
  ]);

  return {
    actor,
    users: users.rows.map((row) => ({
      email: normalizeEmail(row.email),
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      adminNote: row.admin_note ?? null,
      status: row.status,
      pendingEmail: row.pending_email ? normalizeEmail(row.pending_email) : null,
      emailConfirmedAt: isoOrNull(row.email_confirmed_at),
      emailChangeRequestedAt: isoOrNull(row.email_change_requested_at),
      createdAt: isoOrNull(row.created_at) || "",
      updatedAt: isoOrNull(row.updated_at) || "",
    })),
    groups: groups.rows.map((row) => ({
      groupKey: row.group_key,
      name: row.name,
      description: row.description ?? null,
      adminNote: row.admin_note ?? null,
      isSystem: row.is_system,
      memberCount: row.member_count,
    })),
    roles: roles.rows.map((row) => ({
      roleKey: row.role_key,
      name: row.name,
      description: row.description ?? null,
      isSystem: row.is_system,
    })),
    permissions: permissions.rows.map((row) => ({
      permissionKey: row.permission_key,
      resourceType: row.resource_type,
      resourceKey: row.resource_key,
      action: row.action,
      name: row.name,
      description: row.description ?? null,
      isSystem: row.is_system,
    })),
    memberships: memberships.rows.map((row) => ({
      groupKey: row.group_key,
      email: normalizeEmail(row.email),
      expiresAt: isoOrNull(row.expires_at),
      createdAt: isoOrNull(row.created_at) || "",
    })),
    groupRoles: groupRoles.rows.map((row) => ({
      assignmentId: String(row.assignment_id),
      groupKey: row.group_key,
      roleKey: row.role_key,
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      createdAt: isoOrNull(row.created_at) || "",
    })),
    rolePermissions: rolePermissions.rows.map((row) => ({
      roleKey: row.role_key,
      permissionKey: row.permission_key,
      createdAt: isoOrNull(row.created_at) || "",
    })),
    invitations: invitations.rows.map((row) => ({
      invitationId: String(row.invitation_id),
      email: normalizeEmail(row.email),
      previousEmail: row.previous_email ? normalizeEmail(row.previous_email) : null,
      kind: row.kind,
      status: row.status,
      invitedBy: normalizeEmail(row.invited_by),
      invitedAt: isoOrNull(row.invited_at) || "",
      expiresAt: isoOrNull(row.expires_at),
      acceptedAt: isoOrNull(row.accepted_at),
      welcomeEmailSentAt: isoOrNull(row.welcome_email_sent_at),
      errorMessage: row.error_message ?? null,
    })),
    dashboards: accessControlDashboards,
  };
}

function dashboardNameForId(dashboardId: string | null): string | null {
  if (!dashboardId) return null;
  return accessControlDashboards.find((dashboard) => dashboard.id === dashboardId)?.name ?? dashboardId;
}

function dashboardIdForPath(path: string | null): string | null {
  if (!path) return null;
  const pathname = path.split("?")[0];
  if (pathname === "/x-monitor" || pathname.startsWith("/x-monitor/")) return "x-monitor";
  if (pathname === "/zodl-roadmap" || pathname.startsWith("/zodl-roadmap/")) return "zodl-roadmap";
  if (pathname === "/pgpz-roadmap" || pathname.startsWith("/pgpz-roadmap/")) return "pgpz-roadmap";
  if (pathname === "/arktouros" || pathname.startsWith("/arktouros/")) return "arktouros";
  if (pathname === "/2026-zodl-summit" || pathname.startsWith("/2026-zodl-summit/")) return "2026-zodl-summit";
  if (pathname === "/cipherpay-test" || pathname.startsWith("/cipherpay-test/")) return "cipherpay-test";
  if (pathname === "/regulatory-risk" || pathname.startsWith("/regulatory-risk/")) return "regulatory-risk";
  if (pathname === "/app-stores" || pathname.startsWith("/app-stores/")) return "app-store-compliance";
  return null;
}

function normalizeAccessLogFilters(filters: AccessControlAccessLogFilters = {}) {
  const eventType = filters.eventType === "login" || filters.eventType === "dashboard" ? filters.eventType : "all";
  const email = filters.email ? normalizeEmail(filters.email) : "";
  const dashboardId = filters.dashboardId && filters.dashboardId !== "all" ? normalizeKey(filters.dashboardId) : "";
  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;
  const requestedLimit = Number.parseInt(String(filters.limit ?? ""), 10);
  const requestedOffset = Number.parseInt(String(filters.offset ?? ""), 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 100;
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.min(requestedOffset, 100000) : 0;
  return {
    eventType,
    email,
    dashboardId,
    from: from && !Number.isNaN(from.getTime()) ? from.toISOString() : null,
    to: to && !Number.isNaN(to.getTime()) ? to.toISOString() : null,
    limit,
    offset,
  };
}

type AccessControlAccessLogResult = {
  entries: AccessControlAccessLogEntry[];
  meta: AccessControlAccessLogMeta;
};

async function directAccessLog(actorEmail: string, filters: AccessControlAccessLogFilters = {}): Promise<AccessControlAccessLogResult> {
  if (!(await hasAccessControlSchema())) {
    throw new Error("access-control schema is not installed. Run npm run db:migrate.");
  }

  const actor = await resolveDirectEffectiveAccess(actorEmail);
  requireManageAccessPermission(actor);

  const normalized = normalizeAccessLogFilters(filters);
  const values: unknown[] = [];
  const clauses: string[] = [];

  function addParam(value: unknown): string {
    values.push(value);
    return `$${values.length}`;
  }

  if (normalized.eventType !== "all") {
    clauses.push(`event_type = ${addParam(normalized.eventType)}`);
  }
  if (normalized.email) {
    clauses.push(`email = ${addParam(normalized.email)}`);
  }
  if (normalized.dashboardId) {
    clauses.push(`dashboard_id = ${addParam(normalized.dashboardId)}`);
  }
  if (normalized.from) {
    clauses.push(`occurred_at >= ${addParam(normalized.from)}::timestamptz`);
  }
  if (normalized.to) {
    clauses.push(`occurred_at <= ${addParam(normalized.to)}::timestamptz`);
  }

  const limitParam = addParam(normalized.limit + 1);
  const offsetParam = addParam(normalized.offset);
  const result = await getDbPool().query(
    `
      WITH access_events AS (
        SELECT
          event_id::text,
          'login'::text AS event_type,
          email::text,
          provider::text,
          auth_mode::text,
          access_level::text,
          NULL::text AS dashboard_id,
          NULL::text AS path,
          NULL::text AS outcome,
          NULL::integer AS status_code,
          logged_in_at AS occurred_at
        FROM auth_login_events
        UNION ALL
        SELECT
          event_id::text,
          'dashboard'::text AS event_type,
          email::text,
          NULL::text AS provider,
          auth_mode::text,
          access_level::text,
          'x-monitor'::text AS dashboard_id,
          path::text,
          'allowed'::text AS outcome,
          status_code,
          accessed_at AS occurred_at
        FROM xmonitor_access_events
        UNION ALL
        SELECT
          event_id::text,
          'dashboard'::text AS event_type,
          email::text,
          NULL::text AS provider,
          auth_mode::text,
          access_level::text,
          CASE
            WHEN path = '/zodl-roadmap' OR path LIKE '/zodl-roadmap/%' THEN 'zodl-roadmap'
            WHEN path = '/pgpz-roadmap' OR path LIKE '/pgpz-roadmap/%' THEN 'pgpz-roadmap'
            WHEN path = '/arktouros' OR path LIKE '/arktouros/%' THEN 'arktouros'
            WHEN path = '/2026-zodl-summit' OR path LIKE '/2026-zodl-summit/%' THEN '2026-zodl-summit'
            ELSE NULL
          END AS dashboard_id,
          path::text,
          outcome::text,
          status_code,
          accessed_at AS occurred_at
        FROM roadmap_access_events
      )
      SELECT *
      FROM access_events
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY occurred_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    values
  );

  const hasMore = result.rows.length > normalized.limit;
  const pageRows = hasMore ? result.rows.slice(0, normalized.limit) : result.rows;
  const entries = pageRows.map((row) => {
    const dashboardId = row.dashboard_id || dashboardIdForPath(row.path);
    return {
      eventId: row.event_id,
      eventType: row.event_type,
      email: normalizeEmail(row.email),
      provider: row.provider ?? null,
      authMode: row.auth_mode,
      accessLevel: row.access_level,
      dashboardId,
      dashboardName: dashboardNameForId(dashboardId),
      path: row.path ?? null,
      outcome: row.outcome ?? null,
      statusCode: row.status_code ?? null,
      occurredAt: isoOrNull(row.occurred_at) || "",
    };
  });
  return {
    entries,
    meta: {
      limit: normalized.limit,
      offset: normalized.offset,
      returned: entries.length,
      hasMore,
      nextOffset: hasMore ? normalized.offset + normalized.limit : null,
      previousOffset: normalized.offset > 0 ? Math.max(0, normalized.offset - normalized.limit) : null,
    },
  };
}

async function sendAccessEmail({
  actorEmail,
  to,
  subject,
  bodyText,
}: {
  actorEmail: string;
  to: string;
  subject: string;
  bodyText: string;
}): Promise<{ sent: boolean; providerMessageId: string | null; errorMessage: string | null }> {
  const backendBase = backendApiBaseUrl();
  const viewerHeaders = buildViewerProxyHeaders({ email: actorEmail, authMode: "oauth" });
  if (!backendBase || !viewerHeaders) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[access-control] dev email to=${to} subject=${subject}\n${bodyText}`);
      return { sent: false, providerMessageId: null, errorMessage: "email logged in development" };
    }
    throw new Error("welcome email requires XMONITOR_BACKEND_API_BASE_URL and XMONITOR_USER_PROXY_SECRET");
  }

  const response = await fetch(`${backendBase}/email/send`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...viewerHeaders,
    },
    body: JSON.stringify({
      to: [to],
      subject,
      body_markdown: bodyText,
      body_text: bodyText,
    }),
  });

  const responseBody = (await response.json().catch(() => null)) as { provider_message_id?: string; error?: string } | null;
  if (!response.ok) {
    throw new Error(responseBody?.error || `email send failed with ${response.status}`);
  }

  return {
    sent: true,
    providerMessageId: responseBody?.provider_message_id || null,
    errorMessage: null,
  };
}

function appBaseUrl(input?: string): string {
  return (input || process.env.NEXTAUTH_URL || "https://www.zodldashboard.com").replace(/\/+$/, "");
}

function accessSummary(access: EffectiveAccess): string {
  const allowed = accessControlDashboards
    .filter((dashboard) => canReadDashboard(access, dashboard.id))
    .map((dashboard) => `- ${dashboard.name}`);
  return allowed.length ? allowed.join("\n") : "- No dashboards yet";
}

async function createInvitation({
  actorEmail,
  email,
  previousEmail,
  kind,
  appBaseUrl: requestedAppBaseUrl,
}: {
  actorEmail: string;
  email: string;
  previousEmail?: string | null;
  kind: AccessControlInvitationKind;
  appBaseUrl?: string;
}): Promise<{ invitation: AccessControlInvitation; token: string }> {
  const token = newInvitationToken();
  const tokenHash = invitationTokenHash(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  const result = await getDbPool().query(
    `
      INSERT INTO auth_invitations(email, previous_email, token_hash, kind, status, invited_by, expires_at)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6::timestamptz)
      RETURNING invitation_id, email, previous_email, kind, status, invited_by, invited_at, expires_at, accepted_at, welcome_email_sent_at, error_message
    `,
    [email, previousEmail || null, tokenHash, kind, actorEmail, expiresAt]
  );

  const row = result.rows[0];
  return {
    invitation: {
      invitationId: String(row.invitation_id),
      email: normalizeEmail(row.email),
      previousEmail: row.previous_email ? normalizeEmail(row.previous_email) : null,
      kind: row.kind,
      status: row.status,
      invitedBy: normalizeEmail(row.invited_by),
      invitedAt: isoOrNull(row.invited_at) || "",
      expiresAt: isoOrNull(row.expires_at),
      acceptedAt: isoOrNull(row.accepted_at),
      welcomeEmailSentAt: isoOrNull(row.welcome_email_sent_at),
      errorMessage: row.error_message ?? null,
    },
    token,
  };
}

async function sendWelcome(actorEmail: string, email: string, requestedAppBaseUrl?: string): Promise<AccessControlInvitation> {
  const normalizedEmail = assertEmail(email);
  await upsertSubject(normalizedEmail, actorEmail);
  const { invitation, token } = await createInvitation({
    actorEmail,
    email: normalizedEmail,
    kind: "welcome",
    appBaseUrl: requestedAppBaseUrl,
  });
  const access = await resolveDirectEffectiveAccess(normalizedEmail);
  const baseUrl = appBaseUrl(requestedAppBaseUrl);
  const acceptUrl = `${baseUrl}/api/v1/admin/access-control/invitations/accept?token=${encodeURIComponent(token)}`;
  const bodyText = [
    "Welcome to ZODL Dashboard.",
    "",
    "Your account has been added and the current dashboard access preview is:",
    accessSummary(access),
    "",
    `Open this link to acknowledge the invitation and continue to sign in: ${acceptUrl}`,
    "",
    "Use Google sign-in if you have a ZODL workspace account. Approved external guests can use email-link sign-in when it is enabled.",
    "",
    "Do not forward invitation or sign-in links. If your access looks wrong, reply to the person who invited you.",
  ].join("\n");

  try {
    const delivery = await sendAccessEmail({
      actorEmail,
      to: normalizedEmail,
      subject: "Welcome to ZODL Dashboard",
      bodyText,
    });
    await getDbPool().query(
      `
        UPDATE auth_invitations
        SET welcome_email_sent_at = now(),
            provider_message_id = $2,
            error_message = $3
        WHERE invitation_id = $1
      `,
      [invitation.invitationId, delivery.providerMessageId, delivery.errorMessage]
    );
    return {
      ...invitation,
      welcomeEmailSentAt: new Date().toISOString(),
      errorMessage: delivery.errorMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to send welcome email";
    await getDbPool().query(
      `
        UPDATE auth_invitations
        SET error_message = $2
        WHERE invitation_id = $1
      `,
      [invitation.invitationId, message]
    );
    throw error;
  }
}

async function requestEmailChange(actorEmail: string, currentEmail: string, pendingEmail: string, requestedAppBaseUrl?: string): Promise<AccessControlInvitation> {
  const normalizedCurrent = assertEmail(currentEmail);
  const normalizedPending = assertEmail(pendingEmail);
  if (normalizedCurrent === normalizedPending) {
    throw new Error("new email must be different from the current email");
  }

  const existing = await getDbPool().query("SELECT email FROM auth_subjects WHERE email = $1 LIMIT 1", [normalizedPending]);
  if (existing.rows[0]) {
    throw new Error("a user with the new email already exists");
  }

  await getDbPool().query(
    `
      UPDATE auth_subjects
      SET pending_email = $2,
          email_change_requested_at = now(),
          updated_by = $3
      WHERE email = $1
    `,
    [normalizedCurrent, normalizedPending, actorEmail]
  );

  const { invitation, token } = await createInvitation({
    actorEmail,
    email: normalizedPending,
    previousEmail: normalizedCurrent,
    kind: "email-change",
    appBaseUrl: requestedAppBaseUrl,
  });
  const baseUrl = appBaseUrl(requestedAppBaseUrl);
  const confirmUrl = `${baseUrl}/api/v1/admin/access-control/invitations/accept?token=${encodeURIComponent(token)}`;
  const bodyText = [
    "Confirm your ZODL Dashboard email change.",
    "",
    `An admin requested that your dashboard login email change from ${normalizedCurrent} to ${normalizedPending}.`,
    "",
    `Confirm the change here: ${confirmUrl}`,
    "",
    "If you did not expect this, do not open the link and contact the dashboard admin.",
  ].join("\n");

  const delivery = await sendAccessEmail({
    actorEmail,
    to: normalizedPending,
    subject: "Confirm your ZODL Dashboard email change",
    bodyText,
  });
  await getDbPool().query(
    `
      UPDATE auth_invitations
      SET welcome_email_sent_at = now(),
          provider_message_id = $2,
          error_message = $3
      WHERE invitation_id = $1
    `,
    [invitation.invitationId, delivery.providerMessageId, delivery.errorMessage]
  );
  return {
    ...invitation,
    welcomeEmailSentAt: new Date().toISOString(),
    errorMessage: delivery.errorMessage,
  };
}

async function ensureNotLastAdmin(email: string): Promise<void> {
  const normalizedEmail = assertEmail(email);
  const result = await getDbPool().query(
    `
      SELECT COUNT(DISTINCT gm.email)::int AS admin_count
      FROM auth_group_memberships gm
      JOIN auth_group_roles gr ON gr.group_key = gm.group_key
      JOIN auth_role_permissions rp ON rp.role_key = gr.role_key
      WHERE rp.permission_key = $1
        AND (gm.expires_at IS NULL OR gm.expires_at > now())
        AND gm.email <> $2
    `,
    [ACCESS_ADMIN_PERMISSION, normalizedEmail]
  );
  if ((result.rows[0]?.admin_count || 0) < 1) {
    throw new Error("cannot remove the last access-control admin");
  }
}

async function directOperation(actorEmail: string, payload: AccessControlOperation): Promise<AccessControlOperationResult> {
  const actor = await resolveDirectEffectiveAccess(actorEmail);
  requireManageAccessPermission(actor);

  switch (payload.operation) {
    case "upsert_user": {
      const email = assertEmail(payload.email);
      const before = await getDbPool().query("SELECT * FROM auth_subjects WHERE email = $1", [email]);
      const status = payload.status === "inactive" ? "inactive" : "active";
      const result = await getDbPool().query(
        `
          INSERT INTO auth_subjects(email, first_name, last_name, admin_note, status, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $6)
          ON CONFLICT (email) DO UPDATE
          SET first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              admin_note = EXCLUDED.admin_note,
              status = EXCLUDED.status,
              updated_by = EXCLUDED.updated_by
          RETURNING *
        `,
        [email, normalizeText(payload.first_name), normalizeText(payload.last_name), normalizeText(payload.admin_note), status, actor.email]
      );
      await recordAudit(actor.email, "upsert_user", "user", email, before.rows[0] || null, result.rows[0] || null);
      return { message: "User saved." };
    }
    case "delete_user": {
      const email = assertEmail(payload.email);
      await ensureNotLastAdmin(email);
      const before = await getDbPool().query("SELECT * FROM auth_subjects WHERE email = $1", [email]);
      await getDbPool().query("DELETE FROM auth_subjects WHERE email = $1", [email]);
      await recordAudit(actor.email, "delete_user", "user", email, before.rows[0] || null, null);
      return { message: "User deleted." };
    }
    case "request_email_change": {
      const invitation = await requestEmailChange(actor.email, payload.email, payload.pending_email, payload.app_base_url);
      await recordAudit(actor.email, "request_email_change", "user", normalizeEmail(payload.email), null, invitation);
      return { invitation, message: "Email confirmation sent." };
    }
    case "send_welcome": {
      const invitation = await sendWelcome(actor.email, payload.email, payload.app_base_url);
      await recordAudit(actor.email, "send_welcome", "user", normalizeEmail(payload.email), null, invitation);
      return { invitation, message: "Welcome email sent." };
    }
    case "upsert_group": {
      const groupKey = assertKey(payload.group_key, "group_key");
      const before = await getDbPool().query("SELECT * FROM auth_groups WHERE group_key = $1", [groupKey]);
      const result = await getDbPool().query(
        `
          INSERT INTO auth_groups(group_key, name, description, admin_note, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $5)
          ON CONFLICT (group_key) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description,
              admin_note = EXCLUDED.admin_note,
              updated_by = EXCLUDED.updated_by
          RETURNING *
        `,
        [groupKey, normalizeText(payload.name), normalizeText(payload.description), normalizeText(payload.admin_note), actor.email]
      );
      await recordAudit(actor.email, "upsert_group", "group", groupKey, before.rows[0] || null, result.rows[0] || null);
      return { message: "Group saved." };
    }
    case "delete_group": {
      const groupKey = assertKey(payload.group_key, "group_key");
      const before = await getDbPool().query("SELECT * FROM auth_groups WHERE group_key = $1", [groupKey]);
      if (before.rows[0]?.is_system) throw new Error("system groups cannot be deleted");
      await getDbPool().query("DELETE FROM auth_groups WHERE group_key = $1", [groupKey]);
      await recordAudit(actor.email, "delete_group", "group", groupKey, before.rows[0] || null, null);
      return { message: "Group deleted." };
    }
    case "upsert_role": {
      const roleKey = assertKey(payload.role_key, "role_key");
      const before = await getDbPool().query("SELECT * FROM auth_roles WHERE role_key = $1", [roleKey]);
      const result = await getDbPool().query(
        `
          INSERT INTO auth_roles(role_key, name, description, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $4)
          ON CONFLICT (role_key) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description,
              updated_by = EXCLUDED.updated_by
          RETURNING *
        `,
        [roleKey, normalizeText(payload.name), normalizeText(payload.description), actor.email]
      );
      await recordAudit(actor.email, "upsert_role", "role", roleKey, before.rows[0] || null, result.rows[0] || null);
      return { message: "Role saved." };
    }
    case "delete_role": {
      const roleKey = assertKey(payload.role_key, "role_key");
      const before = await getDbPool().query("SELECT * FROM auth_roles WHERE role_key = $1", [roleKey]);
      if (before.rows[0]?.is_system) throw new Error("system roles cannot be deleted");
      await getDbPool().query("DELETE FROM auth_roles WHERE role_key = $1", [roleKey]);
      await recordAudit(actor.email, "delete_role", "role", roleKey, before.rows[0] || null, null);
      return { message: "Role deleted." };
    }
    case "set_group_membership": {
      const groupKey = assertKey(payload.group_key, "group_key");
      const email = assertEmail(payload.email);
      await upsertSubject(email, actor.email);
      const before = await getDbPool().query("SELECT * FROM auth_group_memberships WHERE group_key = $1 AND email = $2", [groupKey, email]);
      if (payload.enabled) {
        const result = await getDbPool().query(
          `
            INSERT INTO auth_group_memberships(group_key, email, expires_at, created_by)
            VALUES ($1, $2, $3::timestamptz, $4)
            ON CONFLICT (group_key, email) DO UPDATE
            SET expires_at = EXCLUDED.expires_at
            RETURNING *
          `,
          [groupKey, email, payload.expires_at || null, actor.email]
        );
        await recordAudit(actor.email, "add_group_membership", "membership", `${groupKey}:${email}`, before.rows[0] || null, result.rows[0] || null);
      } else {
        if (groupKey === "admins") await ensureNotLastAdmin(email);
        await getDbPool().query("DELETE FROM auth_group_memberships WHERE group_key = $1 AND email = $2", [groupKey, email]);
        await recordAudit(actor.email, "remove_group_membership", "membership", `${groupKey}:${email}`, before.rows[0] || null, null);
      }
      return { message: payload.enabled ? "Membership added." : "Membership removed." };
    }
    case "set_role_permission": {
      const roleKey = assertKey(payload.role_key, "role_key");
      const permissionKey = assertPermissionKey(payload.permission_key);
      const before = await getDbPool().query("SELECT * FROM auth_role_permissions WHERE role_key = $1 AND permission_key = $2", [roleKey, permissionKey]);
      if (payload.enabled) {
        const result = await getDbPool().query(
          `
            INSERT INTO auth_role_permissions(role_key, permission_key, created_by)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
            RETURNING *
          `,
          [roleKey, permissionKey, actor.email]
        );
        await recordAudit(actor.email, "add_role_permission", "role_permission", `${roleKey}:${permissionKey}`, before.rows[0] || null, result.rows[0] || null);
      } else {
        await getDbPool().query("DELETE FROM auth_role_permissions WHERE role_key = $1 AND permission_key = $2", [roleKey, permissionKey]);
        await recordAudit(actor.email, "remove_role_permission", "role_permission", `${roleKey}:${permissionKey}`, before.rows[0] || null, null);
      }
      return { message: payload.enabled ? "Permission assigned." : "Permission removed." };
    }
    case "assign_group_role": {
      const groupKey = assertKey(payload.group_key, "group_key");
      const roleKey = assertKey(payload.role_key, "role_key");
      const scopeType = payload.scope_type === "dashboard" ? "dashboard" : "global";
      const scopeKey = scopeType === "dashboard" ? assertKey(payload.scope_key || "", "scope_key") : "*";
      const result = await getDbPool().query(
        `
          INSERT INTO auth_group_roles(group_key, role_key, scope_type, scope_key, created_by)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (group_key, role_key, scope_type, scope_key) DO UPDATE
          SET created_by = COALESCE(auth_group_roles.created_by, EXCLUDED.created_by)
          RETURNING *
        `,
        [groupKey, roleKey, scopeType, scopeKey, actor.email]
      );
      await recordAudit(actor.email, "assign_group_role", "group_role", `${groupKey}:${roleKey}:${scopeType}:${scopeKey}`, null, result.rows[0] || null);
      return { message: "Role assignment saved." };
    }
    case "remove_group_role": {
      const assignmentId = normalizeText(payload.assignment_id);
      if (!assignmentId) throw new Error("assignment_id is required");
      const before = await getDbPool().query("SELECT * FROM auth_group_roles WHERE assignment_id = $1", [assignmentId]);
      await getDbPool().query("DELETE FROM auth_group_roles WHERE assignment_id = $1", [assignmentId]);
      await recordAudit(actor.email, "remove_group_role", "group_role", assignmentId, before.rows[0] || null, null);
      return { message: "Role assignment removed." };
    }
    case "preview_user": {
      return { preview: await resolveDirectEffectiveAccess(payload.email) };
    }
    case "access_log": {
      const result = await directAccessLog(actor.email, payload);
      return { accessLog: result.entries, accessLogMeta: result.meta };
    }
    default:
      throw new Error("unsupported access-control operation");
  }
}

async function backendAdminRequest(actorEmail: string, body: unknown): Promise<AccessControlOperationResult | null> {
  const backendBase = backendApiBaseUrl();
  const viewerHeaders = buildViewerProxyHeaders({ email: actorEmail, authMode: "oauth" });
  if (!backendBase || !viewerHeaders) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), accessControlTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${backendBase}/auth/access-control/admin`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...viewerHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `access-control backend failed with ${response.status}`);
  }
  return (await response.json()) as AccessControlOperationResult;
}

export async function getAccessControlSnapshot(actorEmail: string): Promise<AccessControlSnapshot> {
  const backend = await backendAdminRequest(actorEmail, { operation: "snapshot" }).catch((error) => {
    console.warn(`[access-control] backend snapshot fallback reason=${error instanceof Error ? error.message : "unknown"}`);
    return null;
  });
  if (backend?.snapshot) return backend.snapshot;
  return directSnapshot(actorEmail);
}

export async function getAccessControlAccessLog(
  actorEmail: string,
  filters: AccessControlAccessLogFilters = {}
): Promise<AccessControlAccessLogEntry[]> {
  const backend = await backendAdminRequest(actorEmail, { operation: "access_log", ...filters }).catch((error) => {
    console.warn(`[access-control] backend access-log fallback reason=${error instanceof Error ? error.message : "unknown"}`);
    return null;
  });
  if (backend?.accessLog) return backend.accessLog;
  return (await directAccessLog(actorEmail, filters)).entries;
}

export async function performAccessControlOperation(actorEmail: string, payload: unknown): Promise<AccessControlOperationResult> {
  const operation = payload as AccessControlOperation;
  if (!operation || typeof operation !== "object" || !("operation" in operation)) {
    throw new Error("operation is required");
  }

  const backend = await backendAdminRequest(actorEmail, operation);
  if (backend) return backend;
  return directOperation(actorEmail, operation);
}

export async function acceptAccessInvitation(token: string): Promise<{ kind: AccessControlInvitationKind; email: string }> {
  const tokenValue = normalizeText(token);
  if (!tokenValue) throw new Error("token is required");

  const backendBase = backendApiBaseUrl();
  const proxySecret = process.env.XMONITOR_USER_PROXY_SECRET?.trim();
  if (backendBase && proxySecret) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), accessControlTimeoutMs());
    let response: Response;
    try {
      response = await fetch(`${backendBase}/auth/access-control/invitations/accept`, {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-xmonitor-viewer-secret": proxySecret,
        },
        body: JSON.stringify({ token: tokenValue }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.ok) {
      const body = (await response.json()) as { item: { kind: AccessControlInvitationKind; email: string } };
      return body.item;
    }
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `invitation acceptance failed with ${response.status}`);
  }

  if (!(await hasAccessControlSchema())) {
    throw new Error("access-control schema is not installed");
  }

  const tokenHash = invitationTokenHash(tokenValue);
  const result = await getDbPool().query(
    `
      SELECT invitation_id, email, previous_email, kind, status, expires_at
      FROM auth_invitations
      WHERE token_hash = $1
      LIMIT 1
    `,
    [tokenHash]
  );
  const invitation = result.rows[0];
  if (!invitation || invitation.status !== "pending") {
    throw new Error("invitation is invalid or already used");
  }
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
    await getDbPool().query("UPDATE auth_invitations SET status = 'expired' WHERE invitation_id = $1", [invitation.invitation_id]);
    throw new Error("invitation has expired");
  }

  const email = normalizeEmail(invitation.email);
  if (invitation.kind === "email-change") {
    const previousEmail = normalizeEmail(invitation.previous_email);
    if (!previousEmail) throw new Error("email change invitation is missing the previous email");
    const existing = await getDbPool().query("SELECT email FROM auth_subjects WHERE email = $1 AND email <> $2 LIMIT 1", [email, previousEmail]);
    if (existing.rows[0]) throw new Error("a user with the new email already exists");
    await getDbPool().query(
      `
        UPDATE auth_subjects
        SET email = $2,
            pending_email = NULL,
            email_change_requested_at = NULL,
            email_confirmed_at = now()
        WHERE email = $1
      `,
      [previousEmail, email]
    );
  } else {
    await upsertSubject(email, "invitation");
    await getDbPool().query("UPDATE auth_subjects SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE email = $1", [email]);
  }

  await getDbPool().query(
    `
      UPDATE auth_invitations
      SET status = 'accepted',
          accepted_at = now()
      WHERE invitation_id = $1
    `,
    [invitation.invitation_id]
  );

  return { kind: invitation.kind, email };
}
