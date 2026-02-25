import { headers } from "next/headers";
import { redirect } from "next/navigation";
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

  return <SignInClient error={error} />;
}
