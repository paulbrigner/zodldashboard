import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { recordSuccessfulOAuthLogin, type AuthLoginAccessLevel } from "@/lib/auth-login-events";

const allowedDomain = (process.env.ALLOWED_GOOGLE_DOMAIN || "zodl.com").toLowerCase();
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const guestOauthEnabled = parseBoolean(process.env.GUEST_GOOGLE_OAUTH_ENABLED, false);
const googleGuestClientId = process.env.GOOGLE_GUEST_CLIENT_ID || "";
const googleGuestClientSecret = process.env.GOOGLE_GUEST_CLIENT_SECRET || "";
const allowedGuestEmails = parseEmailAllowlist(process.env.ALLOWED_GUEST_GOOGLE_EMAILS || "");

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function parseEmailAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function accessLevelForProvider(provider: string): AuthLoginAccessLevel | null {
  if (provider === "google") return "workspace";
  if (provider === "google-guest") return "guest";
  return null;
}

function isEmailVerified(profile: unknown): boolean {
  const raw = (profile as { email_verified?: unknown } | undefined)?.email_verified;
  return raw === true || raw === "true" || raw === 1;
}

if (!googleClientId) {
  console.warn("[auth] GOOGLE_CLIENT_ID is missing.");
}

if (!googleClientSecret) {
  console.warn("[auth] GOOGLE_CLIENT_SECRET is missing.");
} else if (!googleClientSecret.startsWith("GOCSPX-")) {
  console.warn(
    "[auth] GOOGLE_CLIENT_SECRET has an unexpected prefix. For Google OAuth web clients it usually starts with GOCSPX-."
  );
}

if (guestOauthEnabled) {
  if (!googleGuestClientId) {
    console.warn("[auth] GUEST_GOOGLE_OAUTH_ENABLED=true but GOOGLE_GUEST_CLIENT_ID is missing.");
  }

  if (!googleGuestClientSecret) {
    console.warn("[auth] GUEST_GOOGLE_OAUTH_ENABLED=true but GOOGLE_GUEST_CLIENT_SECRET is missing.");
  }

  if (allowedGuestEmails.size === 0) {
    console.warn("[auth] GUEST_GOOGLE_OAUTH_ENABLED=true but ALLOWED_GUEST_GOOGLE_EMAILS is empty.");
  }
}

const providers = [
  GoogleProvider({
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    authorization: {
      params: {
        hd: allowedDomain,
        prompt: "select_account",
        scope: "openid email profile",
      },
    },
  }),
];

if (guestOauthEnabled && googleGuestClientId && googleGuestClientSecret) {
  providers.push(
    GoogleProvider({
      id: "google-guest",
      name: "Google (Guest)",
      clientId: googleGuestClientId,
      clientSecret: googleGuestClientSecret,
      authorization: {
        params: {
          prompt: "select_account",
          scope: "openid email profile",
        },
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  debug: process.env.NODE_ENV !== "production",
  providers,
  callbacks: {
    async signIn({ account, profile, user }) {
      const provider = account?.provider || "";
      const email = normalizeEmail((profile as { email?: unknown } | undefined)?.email ?? user?.email);
      const emailVerified = isEmailVerified(profile);

      if (!email || !emailVerified) {
        console.warn(`[auth] denied provider=${provider || "unknown"} reason=unverified_or_missing_email`);
        return false;
      }

      if (provider === "google") {
        const allowed = email.endsWith(`@${allowedDomain}`);
        console.info(`[auth] ${allowed ? "allow" : "deny"} provider=google email=${email} reason=domain_${allowed ? "match" : "mismatch"}`);
        return allowed;
      }

      if (provider === "google-guest") {
        const allowed = guestOauthEnabled && allowedGuestEmails.has(email);
        console.info(
          `[auth] ${allowed ? "allow" : "deny"} provider=google-guest email=${email} reason=${allowed ? "guest_allowlist" : "guest_not_allowlisted"}`
        );
        return allowed;
      }

      console.warn(`[auth] denied provider=${provider || "unknown"} reason=unsupported_provider`);
      return false;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email || null;
      }
      return session;
    },
  },
  events: {
    async signIn({ account, profile, user }) {
      const provider = account?.provider || "";
      const accessLevel = accessLevelForProvider(provider);
      if (!accessLevel) return;

      const email = normalizeEmail((profile as { email?: unknown } | undefined)?.email ?? user?.email);
      if (!email) return;

      await recordSuccessfulOAuthLogin({
        email,
        provider,
        accessLevel,
      });
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  logger: {
    error(code, metadata) {
      console.error("[next-auth][error]", code, metadata);
    },
    warn(code) {
      console.warn("[next-auth][warn]", code);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[next-auth][debug]", code, metadata);
      }
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
