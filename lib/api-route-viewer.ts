import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { evaluateLocalBypass } from "@/lib/local-bypass";

export type ApiRouteViewer = {
  email: string;
  authMode: "oauth" | "local-bypass";
  accessLevel: "workspace" | "guest" | "local-bypass";
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

export async function resolveApiRouteViewer(pathname: string): Promise<ApiRouteViewer | null> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const email = normalizeEmail(session.user.email);
    return {
      email,
      authMode: "oauth",
      accessLevel: isWorkspaceEmail(email) ? "workspace" : "guest",
    };
  }

  const requestHeaders = await headers();
  const bypass = await evaluateLocalBypass(requestHeaders, pathname);
  if (!bypass.allowed) {
    return null;
  }

  return {
    email: normalizeEmail(bypassDisplayEmail),
    authMode: "local-bypass",
    accessLevel: "local-bypass",
  };
}
