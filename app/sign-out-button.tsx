"use client";

import { signOut as nextAuthSignOut } from "next-auth/react";
import { signOut as betterAuthSignOut } from "@/lib/better-auth-client";
import type { AuthSessionProvider } from "@/lib/server-auth-session";

type SignOutButtonProps = {
  authProvider?: AuthSessionProvider;
  className?: string;
};

export function SignOutButton({ authProvider = "next-auth", className = "button button-secondary" }: SignOutButtonProps) {
  async function handleSignOut() {
    if (authProvider === "better-auth") {
      try {
        await betterAuthSignOut();
      } finally {
        window.location.assign("/signin");
      }
      return;
    }

    await nextAuthSignOut({ callbackUrl: "/signin" });
  }

  return (
    <button
      className={className}
      onClick={() => void handleSignOut()}
      type="button"
    >
      Sign out
    </button>
  );
}
