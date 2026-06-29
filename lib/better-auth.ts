import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, magicLink } from "better-auth/plugins";
import { canAuthenticateWithAccessControl, resolveEffectiveAccess } from "@/lib/access-control";
import { recordSuccessfulAuthLogin, type AuthLoginAccessLevel } from "@/lib/auth-login-events";
import {
  allowedGuestEmails,
  guestMagicLinkEnabled,
  guestMagicLinkMaxAgeSeconds,
  normalizeEmail,
  parseBoolean,
  sendGuestMagicLinkEmail,
} from "@/lib/auth-guest-email";
import {
  BETTER_AUTH_BASE_PATH,
  BETTER_AUTH_EMAIL_PROVIDER_ID,
  BETTER_AUTH_GOOGLE_PROVIDER_ID,
  BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID,
} from "@/lib/better-auth-constants";
import { getDbPool } from "@/lib/xmonitor/db";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";

const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_SCOPES = ["openid", "email", "profile"];

type OAuthProfile = {
  email?: unknown;
  email_verified?: unknown;
  emailVerified?: unknown;
  verified_email?: unknown;
  name?: unknown;
  picture?: unknown;
  image?: unknown;
};

function trimValue(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function configuredBaseUrl(): string | undefined {
  return trimValue(process.env.BETTER_AUTH_URL) || trimValue(process.env.NEXTAUTH_URL) || undefined;
}

function configuredSecret(): string | undefined {
  return trimValue(process.env.BETTER_AUTH_SECRET) || trimValue(process.env.NEXTAUTH_SECRET) || undefined;
}

function allowedGoogleDomain(): string {
  return normalizeEmail(process.env.ALLOWED_GOOGLE_DOMAIN || "zodl.com").replace(/^@+/, "");
}

function workspaceEmailAllowed(email: string): boolean {
  const domain = allowedGoogleDomain();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function configuredTrustedOrigins(): string[] {
  const origins = new Set<string>();
  const baseUrl = configuredBaseUrl();
  if (baseUrl) origins.add(baseUrl);

  for (const rawOrigin of (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(/[,\s]+/)) {
    const origin = rawOrigin.trim();
    if (origin) origins.add(origin);
  }

  return Array.from(origins);
}

function profileEmail(profile: OAuthProfile): string {
  return normalizeEmail(profile.email);
}

function profileEmailVerified(profile: OAuthProfile): boolean {
  return (
    profile.email_verified === true ||
    profile.email_verified === "true" ||
    profile.emailVerified === true ||
    profile.emailVerified === "true" ||
    profile.verified_email === true ||
    profile.verified_email === "true"
  );
}

function profileText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function deniedEmailError(provider: string, email: string, reason: string): APIError {
  const normalizedEmail = email || "unknown";
  console.warn(`[better-auth] denied provider=${provider} email=${normalizedEmail} reason=${reason}`);
  return new APIError("FORBIDDEN", {
    code: "EMAIL_NOT_AUTHORIZED",
    message: "This email address is not authorized for ZODL Dashboard.",
  });
}

async function accessLevelForEmail(email: string): Promise<AuthLoginAccessLevel> {
  return (await resolveEffectiveAccess(email)).accessLevel as AuthLoginAccessLevel;
}

async function mapWorkspaceGoogleProfile(profile: OAuthProfile) {
  const email = profileEmail(profile);
  if (!email || !profileEmailVerified(profile)) {
    throw deniedEmailError(BETTER_AUTH_GOOGLE_PROVIDER_ID, email, "unverified_or_missing_email");
  }

  if (!workspaceEmailAllowed(email) || !(await canAuthenticateWithAccessControl(email))) {
    throw deniedEmailError(BETTER_AUTH_GOOGLE_PROVIDER_ID, email, "workspace_access_denied");
  }

  return {
    email,
    emailVerified: true,
    name: profileText(profile.name) || email,
    image: profileText(profile.picture) || profileText(profile.image),
  };
}

async function mapGuestGoogleProfile(profile: Record<string, unknown>) {
  const oauthProfile = profile as OAuthProfile;
  const email = profileEmail(oauthProfile);
  if (!email || !profileEmailVerified(oauthProfile)) {
    throw deniedEmailError(BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID, email, "unverified_or_missing_email");
  }

  if (!(await canAuthenticateWithAccessControl(email))) {
    throw deniedEmailError(BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID, email, "guest_access_denied");
  }

  return {
    email,
    emailVerified: true,
    name: profileText(oauthProfile.name) || email,
    image: profileText(oauthProfile.picture) || profileText(oauthProfile.image),
  };
}

function socialProviders(): BetterAuthOptions["socialProviders"] {
  const googleClientId = trimValue(process.env.GOOGLE_CLIENT_ID);
  const googleClientSecret = trimValue(process.env.GOOGLE_CLIENT_SECRET);

  if (!googleClientId || !googleClientSecret) {
    console.warn("[better-auth] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing; workspace Google OAuth is disabled.");
    return {};
  }

  return {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      scope: GOOGLE_SCOPES,
      prompt: "select_account",
      hd: allowedGoogleDomain(),
      mapProfileToUser: mapWorkspaceGoogleProfile,
    },
  };
}

function betterAuthPlugins(): BetterAuthPlugin[] {
  const plugins: BetterAuthPlugin[] = [];
  const guestOauthEnabled = parseBoolean(process.env.GUEST_GOOGLE_OAUTH_ENABLED, false);
  const googleGuestClientId = trimValue(process.env.GOOGLE_GUEST_CLIENT_ID);
  const googleGuestClientSecret = trimValue(process.env.GOOGLE_GUEST_CLIENT_SECRET);
  const guestMagicLinksEnabled = guestMagicLinkEnabled();

  if (guestOauthEnabled && googleGuestClientId && googleGuestClientSecret) {
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID,
            discoveryUrl: GOOGLE_DISCOVERY_URL,
            issuer: GOOGLE_ISSUER,
            requireIssuerValidation: parseBoolean(
              process.env.BETTER_AUTH_GUEST_GOOGLE_REQUIRE_ISSUER_VALIDATION,
              true
            ),
            clientId: googleGuestClientId,
            clientSecret: googleGuestClientSecret,
            scopes: GOOGLE_SCOPES,
            prompt: "select_account",
            pkce: true,
            mapProfileToUser: mapGuestGoogleProfile,
          },
        ],
      })
    );
  } else if (guestOauthEnabled) {
    console.warn(
      "[better-auth] GUEST_GOOGLE_OAUTH_ENABLED=true but GOOGLE_GUEST_CLIENT_ID/GOOGLE_GUEST_CLIENT_SECRET are missing; guest Google OAuth is disabled."
    );
  }

  if (guestOauthEnabled && allowedGuestEmails().size === 0) {
    console.warn("[better-auth] GUEST_GOOGLE_OAUTH_ENABLED=true but no guest email allowlist is configured.");
  }

  if (guestMagicLinksEnabled) {
    plugins.push(
      magicLink({
        expiresIn: guestMagicLinkMaxAgeSeconds(),
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await sendGuestMagicLinkEmail({ identifier: email, url });
        },
      })
    );
  }

  plugins.push(nextCookies());
  return plugins;
}

async function recordBetterAuthLogin(email: string, provider: string, authMode: "oauth" | "email-link"): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  await recordSuccessfulAuthLogin({
    email: normalizedEmail,
    provider,
    accessLevel: await accessLevelForEmail(normalizedEmail),
    authMode,
  });
}

function providerFromPath(path: string | undefined): { provider: string; authMode: "oauth" | "email-link" } | null {
  if (path?.endsWith("/callback/google")) {
    return { provider: BETTER_AUTH_GOOGLE_PROVIDER_ID, authMode: "oauth" };
  }

  if (path?.endsWith(`/oauth2/callback/${BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID}`)) {
    return { provider: BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID, authMode: "oauth" };
  }

  if (path?.endsWith("/magic-link/verify")) {
    return { provider: BETTER_AUTH_EMAIL_PROVIDER_ID, authMode: "email-link" };
  }

  return null;
}

function databaseConfig(): BetterAuthOptions["database"] | undefined {
  if (!hasDatabaseConfig()) {
    console.warn("[better-auth] DATABASE_URL/PG* missing; Better Auth is running without the target database adapter.");
    return undefined;
  }

  return getDbPool();
}

export const auth = betterAuth({
  appName: "ZODL Dashboard",
  baseURL: configuredBaseUrl(),
  basePath: BETTER_AUTH_BASE_PATH,
  secret: configuredSecret(),
  database: databaseConfig(),
  socialProviders: socialProviders(),
  plugins: betterAuthPlugins(),
  trustedOrigins: configuredTrustedOrigins(),
  user: {
    modelName: "better_auth_users",
  },
  session: {
    modelName: "better_auth_sessions",
  },
  account: {
    modelName: "better_auth_accounts",
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [BETTER_AUTH_GOOGLE_PROVIDER_ID, BETTER_AUTH_GUEST_GOOGLE_PROVIDER_ID],
      allowDifferentEmails: false,
    },
  },
  verification: {
    modelName: "better_auth_verifications",
    storeIdentifier: "hashed",
  },
  rateLimit: {
    enabled: true,
    storage: "memory",
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          const userId = typeof session.userId === "string" ? session.userId : "";
          const user = userId && context ? await context.context.internalAdapter.findUserById(userId) : null;
          const email = normalizeEmail(user?.email);

          if (email && !(await canAuthenticateWithAccessControl(email))) {
            console.warn(`[better-auth] denied provider=session email=${email} reason=access_control_session_backstop`);
            return false;
          }
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const newSession = ctx.context.newSession;
      const provider = providerFromPath(ctx.path);
      if (!newSession || !provider) return;

      await recordBetterAuthLogin(newSession.user.email, provider.provider, provider.authMode);
    }),
  },
  onAPIError: {
    errorURL: "/signin",
    onError(error) {
      console.warn("[better-auth] api error", error);
    },
  },
} satisfies BetterAuthOptions);
