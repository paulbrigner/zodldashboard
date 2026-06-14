# Arktouros Private Dashboard

The Arktouros dashboard follows the same split-repository pattern as the Zodl Roadmap and PGPZ dashboards:

- this `zodldashboard` repo owns the authenticated route, shared dashboard nav shell, home-page card, access checks, access logging, and Amplify build hook;
- the private `zodldashboard_arktouros` repo owns the private dashboard HTML.

## Runtime Access

`/arktouros` allows:

- Google Workspace OAuth users whose email domain matches `ALLOWED_GOOGLE_DOMAIN` (`zodl.com` by default);
- dashboard-authorized guest OAuth or guest magic-link users whose email appears in `ALLOWED_ACCREDIV_GUEST_EMAILS` (`ALLOWED_ROADMAP_GUEST_EMAILS` remains a deprecated alias);
- Arktouros-specific users whose email appears in `ALLOWED_ARKTOUROS_GUEST_EMAILS`;
- local-network bypass users.

Plain guests whose email appears only in `ALLOWED_GUEST_GOOGLE_EMAILS` continue to have X Monitor-only app access.

`ALLOWED_ARKTOUROS_GUEST_EMAILS` is intentionally separate from the general guest list, but Arktouros-listed users are currently dashboard-authorized for all private dashboards that are available now: Zodl Roadmap, Accrediv/PGPZ, and Arktouros. Access to future private dashboards is intentionally undecided until each dashboard is added.

The public `/arktouros` route renders the shared authenticated dashboard shell. The raw private HTML is served inside that shell from `/arktouros/content` with:

- `Cache-Control: private, no-store`
- `X-Robots-Tag: noindex`

## Access Logging

`/arktouros/content` emits a structured `arktouros_access` application log before returning private content or redirecting an authenticated but unauthorized guest. The shell also records denied guest attempts before redirecting. The event includes:

- email
- auth mode (`oauth` or `local-bypass`)
- access level (`workspace`, `guest`, `roadmap-guest`, or `local-bypass`)
- outcome (`allowed`, `denied_guest`, or `content_missing`)
- path, method, status code, client IP, user agent, referer, request id, and timestamp

The same event is sent to the VPC backend at `POST /v1/roadmap/access-events` and persisted in `roadmap_access_events` with `path = '/arktouros'`. If backend persistence is unavailable, the route still emits the structured application log and writes a warning with the audit failure reason.

## Public Repo Pieces

- `lib/dashboard-catalog.ts` contains the shared dashboard registry used by the home page and private dashboard nav shell.
- `app/page.tsx` renders the home-page cards from the shared catalog and gates this card separately.
- `app/private-dashboard-shell.tsx` renders the parent-app nav shell around private HTML dashboards.
- `app/arktouros/page.tsx` renders the shared shell.
- `app/arktouros/content/route.ts` enforces viewer access and returns the private HTML.
- `app/arktouros/[...assetPath]/route.ts` serves authenticated sibling assets from the private repo.
- `lib/viewer-access.ts` defines route-specific access helpers while keeping plain guests limited to X Monitor.
- `lib/private-dashboard-content.ts` reads the configured HTML file.
- `lib/private-dashboard-response.ts` centralizes private HTML and asset response behavior.
- `lib/roadmap-access-events.ts` records user-based Arktouros access audit events.
- `next.config.ts` includes `.private/arktouros/**/*` in the server file trace for the route.
- `.gitignore` excludes `.private/` so private content is not committed here.
- `amplify.yml` optionally checks out the private repo during Amplify `preBuild`.

## Private Repo Layout

The private repo is:

```text
paulbrigner/zodldashboard_arktouros
```

The default expected layout is:

```text
zodldashboard_arktouros/
  index.html
  README.md
  AGENTS.md
  CLAUDE.md
  docs/ZODLDASHBOARD_INTEGRATION.md
```

For now, `index.html` is served as the private dashboard document.

## Local Development Link

From the public `zodldashboard` checkout, place or clone the private repo at:

```text
.private/arktouros/index.html
```

That is the default path read by `/arktouros/content`. To use another path locally, set:

```env
ARKTOUROS_HTML_PATH=/absolute/path/to/index.html
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
ARKTOUROS_PRIVATE_REPO=git@github.com:paulbrigner/zodldashboard_arktouros.git
ARKTOUROS_DEPLOY_KEY_B64=<base64-encoded-private-half-of-read-only-github-deploy-key>
ARKTOUROS_PRIVATE_BRANCH=main
ALLOWED_ARKTOUROS_GUEST_EMAILS=jane@arktouros.co,katja@arktouros.co,mm@arktouros.co,k.albersfiedler@arktouros.co
```

Use a read-only GitHub deploy key scoped only to the private Arktouros repo. A fine-grained GitHub token or machine-user token can be used as a fallback with `ARKTOUROS_GITHUB_TOKEN`, but the deploy key is preferred because it is narrower.

`ARKTOUROS_HTML_PATH` does not need to be set in Amplify when using the default `.private/arktouros/index.html` path.

Prefer setting the Amplify variables in the Amplify console so existing production secrets are not accidentally overwritten. If using the AWS CLI, fetch the existing branch environment variables first, merge in the Arktouros variables, then call `update-branch` with the full merged map.

Because auto-build is disabled, trigger the release after pushing this public repo change and after configuring the Amplify env vars:

```bash
aws amplify start-job \
  --profile zodldashboard \
  --region us-east-1 \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

## Failure Behavior

If the private repo is not configured or the private `index.html` is absent, `/arktouros/content` returns a private `503` placeholder page inside the shared shell to authenticated workspace/local-bypass users and currently dashboard-authorized guests. Plain guests are redirected before any content lookup.
