"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AccessControlAccessLogEntry,
  AccessControlGroup,
  AccessControlSnapshot,
  AccessControlUser,
  EffectiveAccess,
} from "@/lib/access-control";

type AccessAdminClientProps = {
  initialSnapshot: AccessControlSnapshot;
};

const NEW_USER_VALUE = "__new_user__";

type AdminResponse = {
  snapshot?: AccessControlSnapshot;
  preview?: EffectiveAccess;
  accessLog?: AccessControlAccessLogEntry[];
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

function groupMemberEmails(snapshot: AccessControlSnapshot, groupKey: string): string[] {
  return snapshot.memberships.filter((membership) => membership.groupKey === groupKey).map((membership) => membership.email);
}

function userGroupKeys(snapshot: AccessControlSnapshot, email: string): string[] {
  return snapshot.memberships.filter((membership) => membership.email === email).map((membership) => membership.groupKey);
}

function rolePermissionKeys(snapshot: AccessControlSnapshot, roleKey: string): string[] {
  return snapshot.rolePermissions.filter((item) => item.roleKey === roleKey).map((item) => item.permissionKey);
}

function formatDateTime(value: string | null): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AccessAdminClient({ initialSnapshot }: AccessAdminClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedEmail, setSelectedEmail] = useState(initialSnapshot.users[0]?.email || NEW_USER_VALUE);
  const [preview, setPreview] = useState<EffectiveAccess | null>(null);
  const [accessLog, setAccessLog] = useState<AccessControlAccessLogEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [userEmail, setUserEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [userAdminNote, setUserAdminNote] = useState("");
  const [userStatus, setUserStatus] = useState<"active" | "inactive">("active");
  const [sendWelcome, setSendWelcome] = useState(true);
  const [pendingEmail, setPendingEmail] = useState("");

  const [groupKey, setGroupKey] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupAdminNote, setGroupAdminNote] = useState("");

  const [roleKey, setRoleKey] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");

  const [membershipEmail, setMembershipEmail] = useState(initialSnapshot.users[0]?.email || "");
  const [membershipGroup, setMembershipGroup] = useState(initialSnapshot.groups[0]?.groupKey || "");
  const [membershipEnabled, setMembershipEnabled] = useState(true);

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

  const selectedUser = useMemo(
    () => snapshot.users.find((user) => user.email === selectedEmail) || null,
    [snapshot.users, selectedEmail]
  );
  const editingNewUser = selectedEmail === NEW_USER_VALUE;

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
    await perform({
      operation: "upsert_user",
      email: userEmail,
      first_name: firstName,
      last_name: lastName,
      admin_note: userAdminNote,
      status: userStatus,
    });
    if (sendWelcome) {
      await perform({ operation: "send_welcome", email: userEmail });
    }
    setSelectedEmail(userEmail.trim().toLowerCase());
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
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform({
      operation: "upsert_role",
      role_key: roleKey,
      name: roleName,
      description: roleDescription,
    });
  }

  async function previewUser(email = selectedEmail) {
    if (!email || email === NEW_USER_VALUE) {
      setPreview(null);
      return;
    }
    const response = await perform({ operation: "preview_user", email }, false);
    setPreview(response.preview || null);
  }

  async function loadAccessLog(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const response = await perform(
      {
        operation: "access_log",
        email: logEmail || undefined,
        eventType: logEventType,
        dashboardId: logDashboardId,
        from: logFrom || undefined,
        to: logTo || undefined,
        limit: 150,
      },
      false
    );
    setAccessLog(response.accessLog || []);
  }

  useEffect(() => {
    void previewUser(selectedEmail);
    void loadAccessLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedGroups = !editingNewUser && selectedEmail ? userGroupKeys(snapshot, selectedEmail) : [];
  const allowedDashboards = preview
    ? snapshot.dashboards.filter((dashboard) => dashboard.visible && (preview.permissions.includes(dashboard.permissionKey) || preview.permissions.includes("dashboard:*:read")))
    : [];
  const deniedDashboards = preview
    ? snapshot.dashboards.filter((dashboard) => dashboard.visible && !preview.permissions.includes(dashboard.permissionKey) && !preview.permissions.includes("dashboard:*:read"))
    : [];

  return (
    <div className="access-admin-body">
      {error ? <p className="cipherpay-error-text">{error}</p> : null}
      {notice ? <p className="cipherpay-valid-text">{notice}</p> : null}

      <section className="access-admin-section">
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
            <p className="subtle-text">{selectedGroups.join(", ") || "No group memberships"}</p>
          </div>
        </div>
      </section>

      <section className="access-admin-section">
        <header className="access-admin-section-header">
          <div>
            <h2>Groups & Roles</h2>
            <p className="subtle-text">Create groups/roles, assign users to groups, grant roles to groups, and attach permissions to roles.</p>
          </div>
        </header>

        <div className="access-admin-grid access-admin-grid-wide">
          <form className="access-admin-form" onSubmit={saveGroup}>
            <h3>Group</h3>
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
            <div className="button-row">
              <button className="button" disabled={loading} type="submit">Save group</button>
              <button className="button button-secondary" disabled={!groupKey || loading} onClick={() => void perform({ operation: "delete_group", group_key: groupKey })} type="button">
                Delete group
              </button>
            </div>
          </form>

          <form className="access-admin-form" onSubmit={saveRole}>
            <h3>Role</h3>
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
            <div className="button-row">
              <button className="button" disabled={loading} type="submit">Save role</button>
              <button className="button button-secondary" disabled={!roleKey || loading} onClick={() => void perform({ operation: "delete_role", role_key: roleKey })} type="button">
                Delete role
              </button>
            </div>
          </form>
        </div>

        <div className="access-admin-grid access-admin-grid-wide">
          <form className="access-admin-form" onSubmit={(event) => { event.preventDefault(); void perform({ operation: "set_group_membership", email: membershipEmail, group_key: membershipGroup, enabled: membershipEnabled }); }}>
            <h3>User Group Membership</h3>
            <label className="access-admin-field">
              <span>User</span>
              <select className="access-admin-input" onChange={(event) => setMembershipEmail(event.target.value)} value={membershipEmail}>
                {snapshot.users.map((user) => <option key={user.email} value={user.email}>{userLabel(user)}</option>)}
              </select>
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
            <button className="button" disabled={loading} type="submit">Apply membership</button>
          </form>

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
            <button className="button" disabled={loading} type="submit">Apply permission</button>
          </form>
        </div>
      </section>

      <section className="access-admin-section">
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
      </section>

      <section className="access-admin-section">
        <header className="access-admin-section-header">
          <div>
            <h2>Directory Summary</h2>
            <p className="subtle-text">A quick reference for group membership and role bindings.</p>
          </div>
        </header>
        <div className="access-admin-table-wrap">
          <table className="access-admin-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Members</th>
                <th>Role assignments</th>
                <th>Admin note</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.groups.map((group: AccessControlGroup) => (
                <tr key={group.groupKey}>
                  <td>
                    <strong>{group.name}</strong>
                    <p className="access-admin-mono">{group.groupKey}</p>
                  </td>
                  <td>{groupMemberEmails(snapshot, group.groupKey).join(", ") || "none"}</td>
                  <td>
                    <div className="access-admin-assignment-list">
                      {snapshot.groupRoles
                        .filter((assignment) => assignment.groupKey === group.groupKey)
                        .map((assignment) => (
                          <span className="access-admin-assignment-chip" key={assignment.assignmentId}>
                            {assignment.roleKey} ({assignment.scopeType}:{assignment.scopeKey})
                            <button
                              aria-label={`Remove ${assignment.roleKey} from ${group.groupKey}`}
                              onClick={() => void perform({ operation: "remove_group_role", assignment_id: assignment.assignmentId })}
                              type="button"
                            >
                              Remove
                            </button>
                          </span>
                        ))}
                      {snapshot.groupRoles.filter((assignment) => assignment.groupKey === group.groupKey).length === 0 ? "none" : null}
                    </div>
                  </td>
                  <td>{group.adminNote || "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="access-admin-table-wrap">
          <table className="access-admin-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Permissions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.roles.map((role) => (
                <tr key={role.roleKey}>
                  <td>
                    <strong>{role.name}</strong>
                    <p className="access-admin-mono">{role.roleKey}</p>
                  </td>
                  <td>{rolePermissionKeys(snapshot, role.roleKey).join(", ") || "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
