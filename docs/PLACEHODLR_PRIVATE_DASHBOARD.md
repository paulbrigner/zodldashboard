# Placehodlr Private Dashboard

The Placehodlr dashboard follows the split-repository pattern used by the other private dashboards:

- this `zodldashboard` repo owns the authenticated route, dashboard card, RBAC, access checks, access logging, Amplify build hook, and deployment;
- the private `zodldashboard_placehodlr` repo owns the collaborator-editable HTML/JS content.

The stable system identifier, route slug, and private build folder are all `placehodlr`.

## Runtime Access

`/placehodlr` allows:

- Google Workspace OAuth users whose email domain matches `ALLOWED_GOOGLE_DOMAIN` (`zodl.com` by default), through the `workspace-members` group and `workspace-dashboard-viewer` role;
- local-network bypass users.

No guest group receives Placehodlr access by default. Plain X Monitor guests, Accrediv guests, Arktouros guests, and 2026 Zodl Summit guests should not receive Placehodlr access unless an admin explicitly grants a Placehodlr role later.

The public `/placehodlr` route renders the shared authenticated dashboard shell. The raw private HTML is served inside that shell from `/placehodlr/content` with:

- `Cache-Control: private, no-store`
- `X-Robots-Tag: noindex`

## Access Logging

`/placehodlr/content` emits a structured `placehodlr_access` application log before returning private content or redirecting an authenticated but unauthorized viewer. The event is sent to the VPC backend at `POST /v1/roadmap/access-events` and persisted in `roadmap_access_events` with `path = '/placehodlr'`.

The admin access log maps that path back to dashboard id `placehodlr`.

## Public Repo Pieces

- `lib/dashboard-catalog.ts` contains the dashboard registry entry.
- `app/placehodlr/page.tsx` renders the shared shell.
- `app/placehodlr/content/route.ts` enforces viewer access and returns the private HTML.
- `app/placehodlr/[...assetPath]/route.ts` serves authenticated sibling assets from the private repo.
- `lib/private-dashboard-content.ts` reads the configured HTML file.
- `lib/private-dashboard-response.ts` centralizes private HTML and asset response behavior.
- `lib/roadmap-access-events.ts` records user-based access audit events.
- `lib/access-control.ts`, `services/vpc-api-lambda/index.mjs`, and `db/migrations/027_placehodlr_private_dashboard_access.sql` define the dashboard permission and Workspace Members role grant.
- `next.config.ts` includes `.private/placehodlr/**/*` in the server file trace.
- `amplify.yml` optionally checks out the private repo during Amplify `preBuild`.

## Private Repo Layout

The private repo is:

```text
paulbrigner/zodldashboard_placehodlr
```

The expected layout is:

```text
zodldashboard_placehodlr/
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
.private/placehodlr/index.html
```

That is the default path read by `/placehodlr/content`. To use another path locally, set:

```env
PLACEHODLR_HTML_PATH=/absolute/path/to/index.html
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
PLACEHODLR_PRIVATE_REPO=git@github.com:paulbrigner/zodldashboard_placehodlr.git
PLACEHODLR_DEPLOY_KEY_B64=<base64-encoded-private-half-of-read-only-github-deploy-key>
PLACEHODLR_PRIVATE_BRANCH=main
```

Use a read-only GitHub deploy key scoped only to the private Placehodlr repo. A fine-grained GitHub token or machine-user token can be used as a fallback with `PLACEHODLR_GITHUB_TOKEN`, but the deploy key is preferred because it is narrower.

`PLACEHODLR_HTML_PATH` does not need to be set in Amplify when using the default `.private/placehodlr/index.html` path.

## Failure Behavior

If the private repo is not configured or the private `index.html` is absent, `/placehodlr/content` returns a private `503` placeholder page inside the shared shell to authenticated users who have Placehodlr access. Unauthorized users are redirected before any content lookup.
