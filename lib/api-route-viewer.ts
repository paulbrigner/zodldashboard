import { headers } from "next/headers";
import { localBypassEffectiveAccess, resolveEffectiveAccess } from "@/lib/access-control";
import { evaluateLocalBypass } from "@/lib/local-bypass";
import { resolveServerAuthSession, type AuthSessionProvider } from "@/lib/server-auth-session";
import type { ViewerAccessLevel } from "@/lib/viewer-access";

export type ApiRouteViewer = {
  email: string;
  authMode: "oauth" | "local-bypass";
  accessLevel: ViewerAccessLevel;
  status: "active" | "inactive";
  groups: string[];
  roles: string[];
  permissions: string[];
  accessSource: "access-control" | "legacy-env" | "local-bypass";
  authProvider: AuthSessionProvider | null;
};

const bypassDisplayEmail = process.env.LOCAL_BYPASS_DISPLAY_EMAIL || "local-network@zodldashboard.local";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function resolveApiRouteViewer(pathname: string): Promise<ApiRouteViewer | null> {
  const authSession = await resolveServerAuthSession();
  if (authSession) {
    const email = authSession.email;
    const access = await resolveEffectiveAccess(email);
    if (access.status !== "active") return null;
    return {
      email,
      authMode: "oauth",
      accessLevel: access.accessLevel,
      status: access.status,
      groups: access.groups,
      roles: access.roles,
      permissions: access.permissions,
      accessSource: access.source,
      authProvider: authSession.provider,
    };
  }

  const requestHeaders = await headers();
  const bypass = await evaluateLocalBypass(requestHeaders, pathname);
  if (!bypass.allowed) {
    return null;
  }

  const access = localBypassEffectiveAccess(bypassDisplayEmail);
  return {
    email: normalizeEmail(bypassDisplayEmail),
    authMode: "local-bypass",
    accessLevel: access.accessLevel,
    status: access.status,
    groups: access.groups,
    roles: access.roles,
    permissions: access.permissions,
    accessSource: access.source,
    authProvider: null,
  };
}
