import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { evaluateLocalBypass } from "@/lib/local-bypass";
import SignInClient from "./signin-client";

export const runtime = "nodejs";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asBoolean(value: string | undefined, fallback = false): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

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
  const guestOauthEnabled = asBoolean(process.env.GUEST_GOOGLE_OAUTH_ENABLED, false);
  const guestOauthReady = Boolean(process.env.GOOGLE_GUEST_CLIENT_ID && process.env.GOOGLE_GUEST_CLIENT_SECRET);

  return <SignInClient error={error} guestOauthEnabled={guestOauthEnabled && guestOauthReady} />;
}
