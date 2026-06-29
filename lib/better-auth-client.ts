"use client";

import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, magicLinkClient } from "better-auth/client/plugins";
import { BETTER_AUTH_BASE_PATH } from "@/lib/better-auth-constants";

export const betterAuthClient = createAuthClient({
  basePath: BETTER_AUTH_BASE_PATH,
  plugins: [genericOAuthClient(), magicLinkClient()],
});

export const { signIn, signOut, useSession } = betterAuthClient;
