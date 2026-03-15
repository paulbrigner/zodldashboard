import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { recordSuccessfulAuthLogin, type AuthLoginAccessLevel } from "@/lib/auth-login-events";
import {
  GUEST_EMAIL_PROVIDER_ID,
  guestEmailAllowed,
  guestMagicLinkEnabled,
  guestMagicLinkMaxAgeSeconds,
  normalizeEmail,
  parseBoolean,
  parseEmailAllowlist,
  sendGuestMagicLinkVerificationRequest,
} from "@/lib/auth-guest-email";
import { createGuestEmailAdapter } from "@/lib/auth-guest-email-adapter";

const allowedDomain = normalizeEmail(process.env.ALLOWED_GOOGLE_DOMAIN || "zodl.com");
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const guestOauthEnabled = parseBoolean(process.env.GUEST_GOOGLE_OAUTH_ENABLED, false);
const googleGuestClientId = process.env.GOOGLE_GUEST_CLIENT_ID || "";
const googleGuestClientSecret = process.env.GOOGLE_GUEST_CLIENT_SECRET || "";
const allowedGuestEmails = parseEmailAllowlist(process.env.ALLOWED_GUEST_GOOGLE_EMAILS || "");
const guestMagicLinksEnabled = guestMagicLinkEnabled();

function accessLevelForProvider(provider: string): AuthLoginAccessLevel | null {
  if (provider === "google") return "workspace";
  if (provider === "google-guest") return "guest";
  if (provider === GUEST_EMAIL_PROVIDER_ID) return "guest";
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

if (guestMagicLinksEnabled && allowedGuestEmails.size === 0) {
  console.warn("[auth] GUEST_MAGIC_LINK_ENABLED=true but ALLOWED_GUEST_GOOGLE_EMAILS is empty.");
}

const providers: NonNullable<NextAuthOptions["providers"]> = [
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

if (guestMagicLinksEnabled) {
  providers.push(
    EmailProvider({
      maxAge: guestMagicLinkMaxAgeSeconds(),
      sendVerificationRequest: sendGuestMagicLinkVerificationRequest,
    })
  );
}

export const authOptions: NextAuthOptions = {
  adapter: createGuestEmailAdapter(),
  session: { strategy: "jwt" },
  debug: process.env.NODE_ENV !== "production",
  providers,
  callbacks: {
    async signIn({ account, profile, user, email: emailContext }) {
      const provider = account?.provider || "";
      const normalizedEmail = normalizeEmail((profile as { email?: unknown } | undefined)?.email ?? user?.email);
      const emailVerified = provider === GUEST_EMAIL_PROVIDER_ID ? true : isEmailVerified(profile);
      const verificationRequest = emailContext?.verificationRequest === true;

      if (!normalizedEmail || !emailVerified) {
        console.warn(`[auth] denied provider=${provider || "unknown"} reason=unverified_or_missing_email`);
        return false;
      }

      if (provider === "google") {
        const allowed = normalizedEmail.endsWith(`@${allowedDomain}`);
        console.info(
          `[auth] ${allowed ? "allow" : "deny"} provider=google email=${normalizedEmail} reason=domain_${allowed ? "match" : "mismatch"}`
        );
        return allowed;
      }

      if (provider === "google-guest") {
        const allowed = guestOauthEnabled && allowedGuestEmails.has(normalizedEmail);
        console.info(
          `[auth] ${allowed ? "allow" : "deny"} provider=google-guest email=${normalizedEmail} reason=${allowed ? "guest_allowlist" : "guest_not_allowlisted"}`
        );
        return allowed;
      }

      if (provider === GUEST_EMAIL_PROVIDER_ID) {
        const allowed = guestMagicLinksEnabled && guestEmailAllowed(normalizedEmail);
        if (verificationRequest) {
          console.info(
            `[auth] ${allowed ? "allow" : "suppress"} provider=${GUEST_EMAIL_PROVIDER_ID} email=${normalizedEmail} reason=${allowed ? "guest_allowlist" : "guest_not_allowlisted"}`
          );
          return guestMagicLinksEnabled;
        }
        console.info(
          `[auth] ${allowed ? "allow" : "deny"} provider=${GUEST_EMAIL_PROVIDER_ID} email=${normalizedEmail} reason=${allowed ? "guest_allowlist" : "guest_not_allowlisted"}`
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

      await recordSuccessfulAuthLogin({
        email,
        provider,
        accessLevel,
        authMode: provider === GUEST_EMAIL_PROVIDER_ID ? "email-link" : "oauth",
      });
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
    verifyRequest: "/signin/verify-request",
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
