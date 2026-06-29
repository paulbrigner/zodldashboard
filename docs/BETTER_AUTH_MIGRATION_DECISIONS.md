# Better Auth Migration Decisions

Status: decided on 2026-06-29. This document locks the product and architecture decisions for migrating the app from NextAuth/Auth.js to Better Auth. It does not implement the migration.

## Context

The current app uses NextAuth/Auth.js for sign-in and session issuance. Authorization is separate: `lib/access-control.ts` and the access-control tables decide whether an authenticated identity can use the app and which dashboards it can read.

Production currently uses three sign-in paths:

- Zodl workspace Google OAuth via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Guest Google OAuth via `GUEST_GOOGLE_OAUTH_ENABLED` and `GOOGLE_GUEST_CLIENT_ID` / `GOOGLE_GUEST_CLIENT_SECRET`.
- Guest email magic links via `GUEST_MAGIC_LINK_ENABLED`.

A production check on 2026-06-29 showed that guest Google OAuth is active and used. The Amplify `main` branch had `GUEST_GOOGLE_OAUTH_ENABLED=true`, both guest Google client credentials present, and the access-log API returned successful login events for `provider=google-guest` across multiple non-Zodl guest users. Google OAuth must therefore remain part of the target architecture.

## Locked Decisions

### Preserve Google OAuth for Zodl users

Zodl.com users must continue using Google OAuth. The migration must not introduce a password, email-link-only, or other new credential requirement for the primary Zodl user base.

### Preserve a distinct guest Google OAuth flow

Guest Google OAuth remains a supported sign-in option. The Better Auth implementation must preserve two logical Google flows:

- `google` for Zodl workspace users.
- `google-guest` for allowlisted external guests.

The guest flow may be implemented with Better Auth's built-in provider support if it supports a second Google provider with a custom id. Otherwise, implement it with Better Auth's generic OAuth support against Google's OAuth/OIDC endpoints. Either way, the resulting app-level provider identity must remain `google-guest` for policy checks and audit logs.

### Keep the current two-client Google strategy

The migration will keep separate Google OAuth clients for workspace and guest sign-in:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GOOGLE_GUEST_CLIENT_ID` / `GOOGLE_GUEST_CLIENT_SECRET`

Do not combine OAuth clients during the auth-library migration. Any future consolidation should be a separate change with its own production verification.

### Keep guest magic links as a fallback

Guest email magic links remain supported. They are not a replacement for guest Google OAuth in this migration.

### Keep authentication and authorization separate

Better Auth should authenticate identity and issue sessions. It should not become the dashboard authorization source of truth.

The existing access-control path remains authoritative:

- `canAuthenticateWithAccessControl(email)` gates sign-in.
- `resolveEffectiveAccess(email)` resolves status, groups, roles, permissions, and access level.
- Existing dashboard permission checks continue to decide route access.

Plain guests from `ALLOWED_GUEST_GOOGLE_EMAILS` remain X Monitor-only unless access control grants more. Dashboard-specific guest boundaries remain intact.

### Preserve audit semantics

Successful login audit rows must continue to distinguish provider identity:

- `provider=google`
- `provider=google-guest`
- `provider=email`

If Better Auth exposes different internal provider names, adapt them before writing app audit records so the admin access log stays historically coherent.

### Use database-backed Better Auth

The target Better Auth architecture should be database-backed. Stateless session mode is not the target for this app because the app already relies on durable user, account, verification, access-control, and audit behavior.

Create Better Auth tables separately from the existing NextAuth/Auth.js tables to avoid accidental schema collisions. Prefer names that make the ownership clear, such as `better_auth_users`, `better_auth_sessions`, `better_auth_accounts`, and `better_auth_verifications`, unless Better Auth constraints require another naming strategy.

### Migrate durable identity, not active sessions

Migrate or recreate durable user and OAuth account relationships for both `google` and `google-guest`. Do not try to migrate active NextAuth/Auth.js sessions or legacy verification tokens. Users may need to sign in again once after cutover, but they must still use Google OAuth or guest magic link rather than new credentials.

### Cut over only when both Google flows pass

Do not remove NextAuth/Auth.js or switch production auth traffic until both Google flows work end to end in the Better Auth implementation:

- Zodl workspace Google OAuth succeeds.
- Guest Google OAuth succeeds for an allowlisted non-Zodl account.
- Unauthorized guest Google OAuth is denied.
- Guest magic-link sign-in still succeeds for an allowlisted guest.
- Login audit records preserve `google`, `google-guest`, and `email` provider values.
- Dashboard access remains governed by existing access-control permissions.

## Implementation Implications

The migration should start by adding Better Auth in parallel, preferably under a temporary route during development. The current `/signin` UI can then be switched once the provider flows and audit behavior are verified.

Set `BETTER_AUTH_URL` explicitly in production, and verify Google Console redirect URIs for both OAuth clients before cutover. Keep existing `NEXTAUTH_URL` until all invite, magic-link, and rollback paths no longer depend on it.

The implementation should preserve the current sign-in UI shape:

- "Continue with Google (zodl.com)"
- "Continue with Google (Guest)"
- guest email-link form when enabled

## Verification Gates

Before a production cutover, run:

- `git diff --check`
- `npm run typecheck`
- `node --test tests/*.test.mjs`
- local or staging browser smoke checks for both Google buttons and guest magic links
- production-style checks that unauthenticated private dashboard routes redirect to `/signin`
- access-log checks confirming successful login rows by provider
