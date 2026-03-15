import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { guestMagicLinkEnabled, parseBoolean } from "@/lib/auth-guest-email";
import { evaluateLocalBypass } from "@/lib/local-bypass";
import SignInClient from "./signin-client";

export const runtime = "nodejs";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const requestHeaders = await headers();
  const bypass = await evaluateLocalBypass(requestHeaders, "/signin");
  if (bypass.allowed) {
    redirect("/");
  }

  const params = (await searchParams) || {};
  const error = asString(params.error);
  const guestOauthEnabled = parseBoolean(process.env.GUEST_GOOGLE_OAUTH_ENABLED, false);
  const guestOauthReady = Boolean(process.env.GOOGLE_GUEST_CLIENT_ID && process.env.GOOGLE_GUEST_CLIENT_SECRET);
  const guestEmailEnabled = guestMagicLinkEnabled();

  return <SignInClient error={error} guestOauthEnabled={guestOauthEnabled && guestOauthReady} guestEmailEnabled={guestEmailEnabled} />;
}
