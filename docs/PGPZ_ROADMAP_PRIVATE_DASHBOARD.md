# PGPZ Roadmap Private Dashboard

The PGPZ Roadmap dashboard follows the same split-repository pattern as the Zodl Roadmap dashboard while preserving a separate collaborator boundary:

- this `zodldashboard` repo owns the authenticated route, home-page card, access checks, access logging, and Amplify build hook;
- the private `pgpz-roadmap-private` repo owns the collaborator-editable HTML.

The PGPZ collaborator does not need access to `zodl-roadmap-private` and does not need write access to `/zodl-roadmap`. App access and repo access are separate boundaries: dashboard-authorized users can view the dashboards, while the collaborator's GitHub write access is limited to `pgpz-roadmap-private`.

## Runtime access

`/pgpz-roadmap` allows:

- Google Workspace OAuth users whose email domain matches `ALLOWED_GOOGLE_DOMAIN` (`zodl.com` by default);
- dashboard-authorized guest OAuth or guest magic-link users whose email appears in `ALLOWED_ROADMAP_GUEST_EMAILS`;
- local-network bypass users.

Plain guests whose email appears only in `ALLOWED_GUEST_GOOGLE_EMAILS` continue to have X Monitor-only app access.

The route serves HTML with:

- `Cache-Control: private, no-store`
- `X-Robots-Tag: noindex`

## Access logging

`/pgpz-roadmap` emits a structured `pgpz_roadmap_access` application log before returning private content or redirecting an authenticated but unauthorized guest. The event includes:

- email
- auth mode (`oauth` or `local-bypass`)
- access level (`workspace`, `guest`, `roadmap-guest`, or `local-bypass`)
- outcome (`allowed`, `denied_guest`, or `content_missing`)
- path, method, status code, client IP, user agent, referer, request id, and timestamp

The same event is sent to the VPC backend at `POST /v1/roadmap/access-events` and persisted in `roadmap_access_events` with `path = '/pgpz-roadmap'`. If backend persistence is unavailable, the route still emits the structured application log and writes a warning with the audit failure reason.

## Public repo pieces

- `app/page.tsx` contains the home-page card and gates it separately from `/zodl-roadmap`.
- `app/pgpz-roadmap/route.ts` enforces viewer access and returns the private HTML.
- `lib/viewer-access.ts` defines route-specific access helpers while keeping plain guests limited to X Monitor.
- `lib/private-dashboard-content.ts` reads the configured HTML file.
- `lib/roadmap-access-events.ts` records user-based PGPZ roadmap access audit events.
- `next.config.ts` includes `.private/pgpz-roadmap/**/*` in the server file trace for the route.
- `.gitignore` excludes `.private/` so private content is not committed here.
- `amplify.yml` optionally checks out the private repo during Amplify `preBuild`.

## Private repo layout

The private repo is:

```text
paulbrigner/pgpz-roadmap-private
```

The default expected layout is:

```text
pgpz-roadmap-private/
  index.html
  README.md
  AGENTS.md
  CLAUDE.md
  docs/ZODLDASHBOARD_INTEGRATION.md
```

For now, `index.html` is served as the private dashboard document. Arbitrary HTML and JavaScript are permitted for this collaborator relationship.

## Local development link

From the public `zodldashboard` checkout, place or clone the private repo at:

```text
.private/pgpz-roadmap/index.html
```

That is the default path read by `/pgpz-roadmap`. To use another path locally, set:

```env
PGPZ_ROADMAP_HTML_PATH=/absolute/path/to/index.html
```

## Amplify link

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
PGPZ_ROADMAP_PRIVATE_REPO=git@github.com:paulbrigner/pgpz-roadmap-private.git
PGPZ_ROADMAP_DEPLOY_KEY_B64=<base64-encoded-private-half-of-read-only-github-deploy-key>
PGPZ_ROADMAP_PRIVATE_BRANCH=main
```

Use a read-only GitHub deploy key scoped only to the private PGPZ roadmap repo. A fine-grained GitHub token or machine-user token can be used as a fallback with `PGPZ_ROADMAP_GITHUB_TOKEN`, but the deploy key is preferred because it is narrower.

`PGPZ_ROADMAP_HTML_PATH` does not need to be set in Amplify when using the default `.private/pgpz-roadmap/index.html` path.

Prefer setting the Amplify variables in the Amplify console so existing production secrets are not accidentally overwritten. If using the AWS CLI, fetch the existing branch environment variables first, merge in the PGPZ variables, then call `update-branch` with the full merged map.

`div@accrediv.com` is currently dashboard-authorized through `ALLOWED_ROADMAP_GUEST_EMAILS`. Do not add plain X Monitor-only guests to PGPZ dashboard access unless their app role should change.

Because auto-build is disabled, trigger the release after pushing this public repo change and after configuring the Amplify env vars:

```bash
aws amplify start-job \
  --profile zodldashboard \
  --region us-east-1 \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

## Failure behavior

If the private repo is not configured or the private `index.html` is absent, `/pgpz-roadmap` returns a private `503` placeholder page to authenticated workspace/local-bypass users and dashboard-authorized roadmap guests. Plain guests are redirected before any content lookup.
