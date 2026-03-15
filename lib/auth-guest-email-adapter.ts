import type { Adapter, AdapterAccount, AdapterUser, VerificationToken } from "next-auth/adapters";
import { getDbPool } from "@/lib/xmonitor/db";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { normalizeEmail } from "@/lib/auth-guest-email";

const PROXY_SECRET_HEADER = "x-xmonitor-viewer-secret";
const DEFAULT_TIMEOUT_MS = 5_000;

type AdapterUserRow = {
  id: string;
  email: string;
  email_verified?: string | Date | null;
  name?: string | null;
  image?: string | null;
};

function trimValue(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function proxySecret(): string | null {
  return trimValue(process.env.XMONITOR_USER_PROXY_SECRET);
}

function requestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.XMONITOR_AUTH_ADAPTER_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function verificationTokenRowToValue(row: {
  identifier: string;
  token: string;
  expires: string | Date;
}): VerificationToken {
  return {
    identifier: normalizeEmail(row.identifier),
    token: row.token,
    expires: row.expires instanceof Date ? row.expires : new Date(row.expires),
  };
}

function adapterUserRowToValue(row: AdapterUserRow | null | undefined): AdapterUser | null {
  if (!row?.id || !row?.email) return null;
  return {
    id: String(row.id),
    email: normalizeEmail(row.email),
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
    name: row.name || null,
    image: row.image || null,
  };
}

function normalizeAdapterUserInput(user: Partial<AdapterUser> & Pick<AdapterUser, "email">) {
  return {
    email: normalizeEmail(user.email),
    email_verified: user.emailVerified ? user.emailVerified.toISOString() : null,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

async function callBackend<T>(path: string, body: unknown): Promise<T | null> {
  const baseUrl = backendApiBaseUrl();
  const secret = proxySecret();
  if (!baseUrl || !secret) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [PROXY_SECRET_HEADER]: secret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 240);
      throw new Error(`auth adapter backend failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getUserDirect(id: string): Promise<AdapterUser | null> {
  if (!hasDatabaseConfig()) return null;
  const result = await getDbPool().query(
    `
      SELECT id, email, email_verified, name, image
      FROM auth_users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  return adapterUserRowToValue(result.rows[0]);
}

async function getUserByEmailDirect(email: string): Promise<AdapterUser | null> {
  if (!hasDatabaseConfig()) return null;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const result = await getDbPool().query(
    `
      SELECT id, email, email_verified, name, image
      FROM auth_users
      WHERE email = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );
  return adapterUserRowToValue(result.rows[0]);
}

async function getUserByAccountDirect(params: Pick<AdapterAccount, "provider" | "providerAccountId">): Promise<AdapterUser | null> {
  if (!hasDatabaseConfig()) return null;
  const provider = params.provider?.trim().toLowerCase();
  const providerAccountId = params.providerAccountId?.trim();
  if (!provider || !providerAccountId) return null;
  const result = await getDbPool().query(
    `
      SELECT u.id, u.email, u.email_verified, u.name, u.image
      FROM auth_accounts a
      JOIN auth_users u ON u.id = a.user_id
      WHERE a.provider = $1
        AND a.provider_account_id = $2
      LIMIT 1
    `,
    [provider, providerAccountId]
  );
  return adapterUserRowToValue(result.rows[0]);
}

async function createUserDirect(user: Omit<AdapterUser, "id">): Promise<AdapterUser> {
  const normalized = normalizeAdapterUserInput(user);
  const result = await getDbPool().query(
    `
      INSERT INTO auth_users(email, email_verified, name, image)
      VALUES ($1, $2::timestamptz, $3, $4)
      ON CONFLICT (email) DO UPDATE
      SET email_verified = EXCLUDED.email_verified,
          name = EXCLUDED.name,
          image = EXCLUDED.image,
          updated_at = now()
      RETURNING id, email, email_verified, name, image
    `,
    [normalized.email, normalized.email_verified, normalized.name, normalized.image]
  );
  const created = adapterUserRowToValue(result.rows[0]);
  if (!created) throw new Error("failed to create auth user");
  return created;
}

async function updateUserDirect(user: Partial<AdapterUser> & Pick<AdapterUser, "id">): Promise<AdapterUser> {
  const current = await getUserDirect(user.id);
  if (!current) {
    throw new Error("auth user not found");
  }

  const nextEmail = normalizeEmail(user.email ?? current.email);
  const nextEmailVerified = user.emailVerified === undefined ? current.emailVerified : user.emailVerified;
  const nextName = user.name === undefined ? current.name : user.name;
  const nextImage = user.image === undefined ? current.image : user.image;

  const result = await getDbPool().query(
    `
      UPDATE auth_users
      SET email = $2,
          email_verified = $3::timestamptz,
          name = $4,
          image = $5,
          updated_at = now()
      WHERE id = $1
      RETURNING id, email, email_verified, name, image
    `,
    [user.id, nextEmail, nextEmailVerified ? nextEmailVerified.toISOString() : null, nextName, nextImage]
  );
  const updated = adapterUserRowToValue(result.rows[0]);
  if (!updated) throw new Error("failed to update auth user");
  return updated;
}

async function linkAccountDirect(account: AdapterAccount): Promise<AdapterAccount | null | undefined> {
  await getDbPool().query(
    `
      INSERT INTO auth_accounts(
        user_id,
        type,
        provider,
        provider_account_id,
        refresh_token,
        access_token,
        expires_at,
        token_type,
        scope,
        id_token,
        session_state
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (provider, provider_account_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          type = EXCLUDED.type,
          refresh_token = EXCLUDED.refresh_token,
          access_token = EXCLUDED.access_token,
          expires_at = EXCLUDED.expires_at,
          token_type = EXCLUDED.token_type,
          scope = EXCLUDED.scope,
          id_token = EXCLUDED.id_token,
          session_state = EXCLUDED.session_state,
          updated_at = now()
    `,
    [
      account.userId,
      account.type,
      account.provider.toLowerCase(),
      account.providerAccountId,
      account.refresh_token ?? null,
      account.access_token ?? null,
      account.expires_at ?? null,
      account.token_type ?? null,
      account.scope ?? null,
      account.id_token ?? null,
      account.session_state ?? null,
    ]
  );
  return account;
}

async function createVerificationTokenDirect(token: VerificationToken): Promise<VerificationToken> {
  const normalizedIdentifier = normalizeEmail(token.identifier);
  const result = await getDbPool().query(
    `
      INSERT INTO auth_verification_tokens(identifier, token, expires)
      VALUES ($1, $2, $3::timestamptz)
      RETURNING identifier, token, expires
    `,
    [normalizedIdentifier, token.token, token.expires.toISOString()]
  );
  return verificationTokenRowToValue(result.rows[0]);
}

async function useVerificationTokenDirect(params: {
  identifier: string;
  token: string;
}): Promise<VerificationToken | null> {
  const normalizedIdentifier = normalizeEmail(params.identifier);
  const result = await getDbPool().query(
    `
      DELETE FROM auth_verification_tokens
      WHERE identifier = $1
        AND token = $2
      RETURNING identifier, token, expires
    `,
    [normalizedIdentifier, params.token]
  );
  return verificationTokenRowToValue(result.rows[0]) || null;
}

export function createGuestEmailAdapter(): Adapter {
  return {
    async getUser(id) {
      try {
        const response = await callBackend<{ item: AdapterUserRow | null }>("/auth/guest-email/users/get-by-id", { id });
        if (response) return adapterUserRowToValue(response.item);
        return await getUserDirect(id);
      } catch (error) {
        const fallback = await getUserDirect(id);
        if (fallback) return fallback;
        throw error;
      }
    },
    async getUserByEmail(email: string) {
      try {
        const response = await callBackend<{ item: AdapterUserRow | null }>("/auth/guest-email/users/get-by-email", { email });
        if (response) return adapterUserRowToValue(response.item);
        return await getUserByEmailDirect(email);
      } catch (error) {
        const fallback = await getUserByEmailDirect(email);
        if (fallback) return fallback;
        throw error;
      }
    },
    async getUserByAccount(params) {
      try {
        const response = await callBackend<{ item: AdapterUserRow | null }>("/auth/guest-email/users/get-by-account", {
          provider: params.provider,
          provider_account_id: params.providerAccountId,
        });
        if (response) return adapterUserRowToValue(response.item);
        return await getUserByAccountDirect(params);
      } catch (error) {
        const fallback = await getUserByAccountDirect(params);
        if (fallback) return fallback;
        throw error;
      }
    },
    async createUser(user: Omit<AdapterUser, "id">) {
      try {
        const response = await callBackend<{ item: AdapterUserRow }>("/auth/guest-email/users/create", {
          email: user.email,
          email_verified: user.emailVerified ? user.emailVerified.toISOString() : null,
          name: user.name ?? null,
          image: user.image ?? null,
        });
        if (response?.item) {
          const created = adapterUserRowToValue(response.item);
          if (created) return created;
        }
        return await createUserDirect(user);
      } catch (error) {
        return await createUserDirect(user);
      }
    },
    async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
      try {
        const response = await callBackend<{ item: AdapterUserRow }>("/auth/guest-email/users/update", {
          id: user.id,
          email: user.email ?? null,
          email_verified: user.emailVerified ? user.emailVerified.toISOString() : user.emailVerified === null ? null : undefined,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        });
        if (response?.item) {
          const updated = adapterUserRowToValue(response.item);
          if (updated) return updated;
        }
        return await updateUserDirect(user);
      } catch (error) {
        return await updateUserDirect(user);
      }
    },
    async linkAccount(account: AdapterAccount) {
      try {
        const response = await callBackend<{ item: unknown }>("/auth/guest-email/accounts/link", {
          user_id: account.userId,
          type: account.type,
          provider: account.provider,
          provider_account_id: account.providerAccountId,
          refresh_token: account.refresh_token ?? null,
          access_token: account.access_token ?? null,
          expires_at: account.expires_at ?? null,
          token_type: account.token_type ?? null,
          scope: account.scope ?? null,
          id_token: account.id_token ?? null,
          session_state: account.session_state ?? null,
        });
        if (response) return undefined;
        return await linkAccountDirect(account);
      } catch (error) {
        return await linkAccountDirect(account);
      }
    },
    async createVerificationToken(token: VerificationToken) {
      try {
        const response = await callBackend<{ item: VerificationToken }>("/auth/guest-email/tokens/create", {
          identifier: token.identifier,
          token: token.token,
          expires: token.expires.toISOString(),
        });
        if (response?.item) {
          return verificationTokenRowToValue(response.item);
        }
        return await createVerificationTokenDirect(token);
      } catch (error) {
        return await createVerificationTokenDirect(token);
      }
    },
    async useVerificationToken(params: { identifier: string; token: string }) {
      try {
        const response = await callBackend<{ item: VerificationToken | null }>("/auth/guest-email/tokens/use", params);
        if (response) {
          return response.item ? verificationTokenRowToValue(response.item) : null;
        }
        return await useVerificationTokenDirect(params);
      } catch (error) {
        return await useVerificationTokenDirect(params);
      }
    },
  };
}
