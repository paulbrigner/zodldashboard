import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { evaluateLocalBypass } from "@/lib/local-bypass";

export type AuthenticatedViewer = {
  mode: "oauth" | "local-bypass";
  accessLevel: "workspace" | "guest" | "local-bypass";
  email: string;
  canSignOut: boolean;
  bypassClientIp: string | null;
};

const bypassDisplayEmail = process.env.LOCAL_BYPASS_DISPLAY_EMAIL || "local-network@zodldashboard.local";
const allowedGoogleDomain = normalizeDomain(process.env.ALLOWED_GOOGLE_DOMAIN || "zodl.com");

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isWorkspaceEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) return false;
  return normalized.slice(atIndex + 1) === allowedGoogleDomain;
}

export async function requireAuthenticatedViewer(pathname: string): Promise<AuthenticatedViewer> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const email = normalizeEmail(session.user.email);
    return {
      mode: "oauth",
      accessLevel: isWorkspaceEmail(email) ? "workspace" : "guest",
      email,
      canSignOut: true,
      bypassClientIp: null,
    };
  }

  const requestHeaders = await headers();
  const bypass = await evaluateLocalBypass(requestHeaders, pathname);
  if (bypass.allowed) {
    return {
      mode: "local-bypass",
      accessLevel: "local-bypass",
      email: bypassDisplayEmail,
      canSignOut: false,
      bypassClientIp: bypass.clientIp,
    };
  }

  redirect("/signin");
}
