import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { auth } from "@/lib/better-auth";
import { normalizeEmail } from "@/lib/auth-guest-email";

export type AuthSessionProvider = "next-auth" | "better-auth";

export type ServerAuthSession = {
  email: string;
  provider: AuthSessionProvider;
};

export async function resolveServerAuthSession(requestHeaders?: Headers): Promise<ServerAuthSession | null> {
  const nextAuthSession = await getServerSession(authOptions);
  const nextAuthEmail = normalizeEmail(nextAuthSession?.user?.email);
  if (nextAuthEmail) {
    return { email: nextAuthEmail, provider: "next-auth" };
  }

  const headerSource = requestHeaders || ((await headers()) as unknown as Headers);
  const betterAuthSession = await auth.api.getSession({
    headers: headerSource,
    query: {
      disableRefresh: true,
    },
  });
  const betterAuthEmail = normalizeEmail(betterAuthSession?.user?.email);
  if (betterAuthEmail) {
    return { email: betterAuthEmail, provider: "better-auth" };
  }

  return null;
}
