import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { localBypassEffectiveAccess, resolveEffectiveAccess } from "@/lib/access-control";
import { evaluateLocalBypass } from "@/lib/local-bypass";
import { resolveServerAuthSession, type AuthSessionProvider } from "@/lib/server-auth-session";
import type { ViewerAccessLevel } from "@/lib/viewer-access";

export type AuthenticatedViewer = {
  mode: "oauth" | "local-bypass";
  accessLevel: ViewerAccessLevel;
  status: "active" | "inactive";
  groups: string[];
  roles: string[];
  permissions: string[];
  accessSource: "access-control" | "legacy-env" | "local-bypass";
  authProvider: AuthSessionProvider | null;
  email: string;
  canSignOut: boolean;
  bypassClientIp: string | null;
};

const bypassDisplayEmail = process.env.LOCAL_BYPASS_DISPLAY_EMAIL || "local-network@zodldashboard.local";

export async function requireAuthenticatedViewer(pathname: string): Promise<AuthenticatedViewer> {
  const authSession = await resolveServerAuthSession();
  if (authSession) {
    const email = authSession.email;
    const access = await resolveEffectiveAccess(email);
    if (access.status !== "active") {
      redirect("/signin");
    }
    return {
      mode: "oauth",
      accessLevel: access.accessLevel,
      status: access.status,
      groups: access.groups,
      roles: access.roles,
      permissions: access.permissions,
      accessSource: access.source,
      authProvider: authSession.provider,
      email,
      canSignOut: true,
      bypassClientIp: null,
    };
  }

  const requestHeaders = await headers();
  const bypass = await evaluateLocalBypass(requestHeaders, pathname);
  if (bypass.allowed) {
    const access = localBypassEffectiveAccess(bypassDisplayEmail);
    return {
      mode: "local-bypass",
      accessLevel: access.accessLevel,
      status: access.status,
      groups: access.groups,
      roles: access.roles,
      permissions: access.permissions,
      accessSource: access.source,
      authProvider: null,
      email: bypassDisplayEmail,
      canSignOut: false,
      bypassClientIp: bypass.clientIp,
    };
  }

  redirect("/signin");
}
