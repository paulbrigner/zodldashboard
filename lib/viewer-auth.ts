import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { evaluateLocalBypass } from "@/lib/local-bypass";

export type AuthenticatedViewer = {
  mode: "oauth" | "local-bypass";
  email: string;
  canSignOut: boolean;
  bypassClientIp: string | null;
};

const bypassDisplayEmail = process.env.LOCAL_BYPASS_DISPLAY_EMAIL || "local-network@zodldashboard.local";

export async function requireAuthenticatedViewer(pathname: string): Promise<AuthenticatedViewer> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    return {
      mode: "oauth",
      email: session.user.email,
      canSignOut: true,
      bypassClientIp: null,
    };
  }

  const requestHeaders = await headers();
  const bypass = await evaluateLocalBypass(requestHeaders, pathname);
  if (bypass.allowed) {
    return {
      mode: "local-bypass",
      email: bypassDisplayEmail,
      canSignOut: false,
      bypassClientIp: bypass.clientIp,
    };
  }

  redirect("/signin");
}
