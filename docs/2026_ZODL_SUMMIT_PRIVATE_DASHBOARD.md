# 2026 Zodl Summit Private Dashboard

The 2026 Zodl Summit dashboard follows the split-repository pattern used by the Zodl Roadmap, Accrediv/PGPZ, and Arktouros dashboards:

- this `zodldashboard` repo owns the authenticated route, dashboard card, access checks, access logging, Amplify build hook, and deployment;
- the private `2026-zodl-summit` repo owns the collaborator-editable HTML/JS content.

The stable system identifier, route slug, and private build folder are all `2026-zodl-summit`.

## Runtime Access

`/2026-zodl-summit` allows:

- Google Workspace OAuth users whose email domain matches `ALLOWED_GOOGLE_DOMAIN` (`zodl.com` by default);
- local-network bypass users;
- guest OAuth or guest magic-link users whose email appears in `ALLOWED_ZODL_SUMMIT_GUEST_EMAILS`.

Summit guests are intentionally isolated in the `2026-zodl-summit-guests` group. They receive the `zodl-summit-viewer` role, which carries only the `dashboard:2026-zodl-summit:read` permission. Plain X Monitor guests and the Accrediv/Arktouros guest groups should not receive Summit access unless an admin explicitly assigns it.

The public `/2026-zodl-summit` route renders the shared authenticated dashboard shell. The raw private HTML is served inside that shell from `/2026-zodl-summit/content` with:

- `Cache-Control: private, no-store`
- `X-Robots-Tag: noindex`

## Access Logging

`/2026-zodl-summit/content` emits a structured `zodl_summit_access` application log before returning private content or redirecting an authenticated but unauthorized viewer. The event is sent to the VPC backend at `POST /v1/roadmap/access-events` and persisted in `roadmap_access_events` with `path = '/2026-zodl-summit'`.

The admin access log maps that path back to dashboard id `2026-zodl-summit`.

## Public Repo Pieces

- `lib/dashboard-catalog.ts` contains the dashboard registry entry.
- `app/2026-zodl-summit/page.tsx` renders the shared shell.
- `app/2026-zodl-summit/content/route.ts` enforces viewer access and returns the private HTML.
- `app/2026-zodl-summit/[...assetPath]/route.ts` serves authenticated sibling assets from the private repo.
- `lib/private-dashboard-content.ts` reads the configured HTML file.
- `lib/private-dashboard-response.ts` centralizes private HTML and asset response behavior.
- `lib/roadmap-access-events.ts` records user-based access audit events.
- `lib/access-control.ts`, `services/vpc-api-lambda/index.mjs`, and `db/migrations/022_2026_zodl_summit_access_control.sql` define the dashboard permission and guest group.
- `next.config.ts` includes `.private/2026-zodl-summit/**/*` in the server file trace.
- `amplify.yml` optionally checks out the private repo during Amplify `preBuild`.

## Private Repo Layout

The private repo is:

```text
paulbrigner/2026-zodl-summit
```

The expected layout is:

```text
2026-zodl-summit/
  index.html
  README.md
  AGENTS.md
  CLAUDE.md
  docs/ZODLDASHBOARD_INTEGRATION.md
  docs/AMPLIFY_RELEASE_RUNBOOK.md
```

`index.html` should include:

```html
<link rel="icon" href="/icon.svg" type="image/svg+xml">
```

## Local Development Link

From the public `zodldashboard` checkout, place or clone the private repo at:

```text
.private/2026-zodl-summit/index.html
```

That is the default path read by `/2026-zodl-summit/content`. To use another path locally, set:

```env
ZODL_SUMMIT_HTML_PATH=/absolute/path/to/index.html
```

## Amplify Link

The verified Amplify app for this checkout is:

- app name: `zodldashboard`
- app id: `d2rgmein7vsf2e`
- branch: `main`
- region: `us-east-1`
- platform: `WEB_COMPUTE`
- branch stage: `PRODUCTION`
- auto-build: disabled

Add these Amplify environment variables for the `main` branch:

```env
ZODL_SUMMIT_PRIVATE_REPO=git@github.com:paulbrigner/2026-zodl-summit.git
ZODL_SUMMIT_DEPLOY_KEY_B64=<base64-encoded-private-half-of-read-only-github-deploy-key>
ZODL_SUMMIT_PRIVATE_BRANCH=main
ALLOWED_ZODL_SUMMIT_GUEST_EMAILS=
```

Use a read-only GitHub deploy key scoped only to the private Summit repo. A fine-grained GitHub token or machine-user token can be used as a fallback with `ZODL_SUMMIT_GITHUB_TOKEN`, but the deploy key is preferred because it is narrower.

`ZODL_SUMMIT_HTML_PATH` does not need to be set in Amplify when using the default `.private/2026-zodl-summit/index.html` path.

## Failure Behavior

If the private repo is not configured or the private `index.html` is absent, `/2026-zodl-summit/content` returns a private `503` placeholder page inside the shared shell to authenticated users who have Summit access. Unauthorized users are redirected before any content lookup.
