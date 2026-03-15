import type { SendVerificationRequestParams } from "next-auth/providers/email";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";

const PROXY_SECRET_HEADER = "x-xmonitor-viewer-secret";
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;

export const GUEST_EMAIL_PROVIDER_ID = "email";

function trimValue(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function parseEmailAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(/[,\s]+/)
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean)
  );
}

export function allowedGuestEmails(): Set<string> {
  return parseEmailAllowlist(process.env.ALLOWED_GUEST_GOOGLE_EMAILS || "");
}

export function guestEmailAllowed(email: string): boolean {
  return allowedGuestEmails().has(normalizeEmail(email));
}

export function guestMagicLinkEnabled(): boolean {
  const explicit = trimValue(process.env.GUEST_MAGIC_LINK_ENABLED);
  if (explicit != null) {
    return parseBoolean(explicit, false);
  }

  // Amplify has been reliably surfacing the guest OAuth toggle and allowlist, so
  // use those as a fallback signal when the dedicated magic-link flag is absent.
  const guestOauthEnabled = parseBoolean(process.env.GUEST_GOOGLE_OAUTH_ENABLED, false);
  return guestOauthEnabled && allowedGuestEmails().size > 0 && Boolean(backendApiBaseUrl()) && Boolean(proxySecret());
}

export function guestMagicLinkMaxAgeSeconds(): number {
  const parsed = Number.parseInt(process.env.GUEST_MAGIC_LINK_MAX_AGE_SECONDS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AGE_SECONDS;
}

function guestMagicLinkFromAddress(): string | null {
  return trimValue(process.env.GUEST_MAGIC_LINK_FROM_ADDRESS) || trimValue(process.env.XMONITOR_EMAIL_FROM_ADDRESS);
}

function guestMagicLinkFromName(): string {
  return trimValue(process.env.GUEST_MAGIC_LINK_FROM_NAME) || "ZODL Dashboard";
}

function proxySecret(): string | null {
  return trimValue(process.env.XMONITOR_USER_PROXY_SECRET);
}

function requestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.GUEST_MAGIC_LINK_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function verificationEmailSubject(host: string): string {
  return `Your guest sign-in link for ${host}`;
}

function verificationEmailText({ url, host }: { url: string; host: string }): string {
  return [
    `Sign in to ${host}`,
    "",
    "Use the link below to sign in as an approved guest user:",
    url,
    "",
    "If you did not request this email, you can safely ignore it.",
  ].join("\n");
}

function verificationEmailHtml({ url, host }: { url: string; host: string }): string {
  return `
<body style="background:#f7f9fc;margin:0;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#1f2a44;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #d7e3ff;border-radius:18px;">
    <tr>
      <td style="padding:32px 32px 16px 32px;font-size:28px;font-weight:700;color:#274b9f;">ZODL Dashboard</td>
    </tr>
    <tr>
      <td style="padding:0 32px 12px 32px;font-size:18px;line-height:1.5;">
        Use the button below to sign in to <strong>${host}</strong> as an approved guest user.
      </td>
    </tr>
    <tr>
      <td style="padding:12px 32px 24px 32px;">
        <a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#2d56a1;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;padding:14px 22px;border-radius:999px;">
          Sign in
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 12px 32px;font-size:14px;line-height:1.6;color:#4f5f7f;">
        If the button does not work, open this link directly:
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 20px 32px;font-size:14px;line-height:1.6;word-break:break-word;">
        <a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#2d56a1;">${url}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 32px 32px;font-size:14px;line-height:1.6;color:#4f5f7f;">
        If you did not request this email, you can safely ignore it.
      </td>
    </tr>
  </table>
</body>
  `.trim();
}

async function sendViaBackend({
  identifier,
  subject,
  text,
  html,
}: {
  identifier: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const baseUrl = backendApiBaseUrl();
  const secret = proxySecret();
  const fromAddress = guestMagicLinkFromAddress();

  if (!baseUrl || !secret || !fromAddress) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/auth/guest-email/send-verification`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [PROXY_SECRET_HEADER]: secret,
      },
      body: JSON.stringify({
        to: identifier,
        from_address: fromAddress,
        from_name: guestMagicLinkFromName(),
        subject,
        text,
        html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 240);
      throw new Error(`guest magic link email failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    return true;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendGuestMagicLinkVerificationRequest(
  params: SendVerificationRequestParams
): Promise<void> {
  const identifier = normalizeEmail(params.identifier);
  const enabled = guestMagicLinkEnabled();
  const allowed = enabled && guestEmailAllowed(identifier);

  if (!enabled) {
    throw new Error("guest email magic links are disabled");
  }

  if (!allowed) {
    console.info(`[auth] suppress provider=${GUEST_EMAIL_PROVIDER_ID} email=${identifier} reason=guest_allowlist_miss`);
    return;
  }

  const host = new URL(params.url).host;
  const subject = verificationEmailSubject(host);
  const text = verificationEmailText({ url: params.url, host });
  const html = verificationEmailHtml({ url: params.url, host });

  if (await sendViaBackend({ identifier, subject, text, html })) {
    console.info(`[auth] sent provider=${GUEST_EMAIL_PROVIDER_ID} email=${identifier} reason=guest_magic_link`);
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[auth] dev_magic_link email=${identifier} url=${params.url}`);
    return;
  }

  throw new Error("guest magic-link delivery is not configured");
}
