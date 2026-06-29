# Better Auth Parallel Migration

Status: phase 1 scaffold added on 2026-06-29.

This phase adds Better Auth next to the existing NextAuth/Auth.js implementation. It does not switch `/signin`, remove `/api/auth/[...nextauth]`, or change the production session path.

## Guardrails

- Better Auth is mounted at `/api/better-auth/[...all]`; NextAuth remains mounted at `/api/auth/[...nextauth]`.
- Better Auth uses separate core table names: `better_auth_users`, `better_auth_sessions`, `better_auth_accounts`, `better_auth_verifications`, and `better_auth_rate_limits`.
- Workspace Google OAuth stays `provider=google` and uses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Guest Google OAuth stays logically `provider=google-guest` and uses `GOOGLE_GUEST_CLIENT_ID` / `GOOGLE_GUEST_CLIENT_SECRET` through Better Auth generic OAuth.
- Guest magic links reuse the existing delivery and allowlist helper, so both auth stacks share the same guest email policy.
- OAuth profile mapping calls `canAuthenticateWithAccessControl(email)` before Better Auth persists the user profile.
- Successful Better Auth login callbacks write existing `auth_login_events` rows with provider values `google`, `google-guest`, or `email`.

## Callback URLs

Configure these redirect URIs in the matching Google OAuth clients before smoke testing the Better Auth path:

- Workspace Google client: `https://www.zodldashboard.com/api/better-auth/callback/google`
- Guest Google client: `https://www.zodldashboard.com/api/better-auth/oauth2/callback/google-guest`

For local smoke testing, use the same paths under `http://localhost:3000`.

## Browser Test Page

The unlinked `/better-auth-test` page starts the Better Auth workspace and guest Google flows without changing the production `/signin` page.

## Environment

Set these alongside the existing NextAuth values:

- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `BETTER_AUTH_GUEST_GOOGLE_REQUIRE_ISSUER_VALIDATION`

Keep `NEXTAUTH_URL` and `NEXTAUTH_SECRET` until all invite, email-link, and rollback paths no longer depend on NextAuth.

## Cutover Gates

Before moving `/signin` to Better Auth:

- Run `git diff --check`.
- Run `npm run typecheck`.
- Run `node --test tests/*.test.mjs`.
- Run browser smoke tests for workspace Google, guest Google, unauthorized guest Google, and guest magic links.
- Confirm `auth_login_events` contains successful Better Auth rows with the expected provider values.
- Confirm dashboard access still comes from `resolveEffectiveAccess(email)` and route-specific permission checks.
