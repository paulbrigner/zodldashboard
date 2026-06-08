# Zodl Roadmap Private Dashboard

The Zodl Roadmap dashboard is intentionally split across two repositories:

- this public `zodldashboard` repo owns the authenticated route, shared dashboard nav shell, home-page card, access checks, access logging, and Amplify build hook;
- a separate private repo owns the actual roadmap HTML.

The title card text lives in this public repo, but guest users see the same blurred restricted card treatment used by the other workspace-only dashboards for UX consistency. The card copy is not treated as secret. The HTML returned by `/zodl-roadmap` is private at both the source-control and runtime layers.

## Runtime access

`/zodl-roadmap` allows:

- Google Workspace OAuth users whose email domain matches `ALLOWED_GOOGLE_DOMAIN` (`zodl.com` by default);
- dashboard-authorized guest OAuth or guest magic-link users whose email appears in `ALLOWED_ROADMAP_GUEST_EMAILS`;
- Arktouros team guest OAuth or guest magic-link users whose email appears in `ALLOWED_ARKTOUROS_GUEST_EMAILS`;
- local-network bypass users.

Plain guests whose email appears only in `ALLOWED_GUEST_GOOGLE_EMAILS` continue to have X Monitor-only app access. `ALLOWED_ARKTOUROS_GUEST_EMAILS` grants access to private dashboards that are currently available; access to future private dashboards is intentionally undecided until each dashboard is added.

The public `/zodl-roadmap` route renders the shared authenticated dashboard shell. The raw private HTML is served inside that shell from `/zodl-roadmap/content` with:

- `Cache-Control: private, no-store`
- `X-Robots-Tag: noindex`

## Access logging

`/zodl-roadmap/content` emits a structured `zodl_roadmap_access` application log before returning private content or redirecting an authenticated guest. The shell also records denied guest attempts before redirecting. The event includes:

- email
- auth mode (`oauth` or `local-bypass`)
- access level (`workspace`, `guest`, `roadmap-guest`, or `local-bypass`)
- outcome (`allowed`, `denied_guest`, or `content_missing`)
- path, method, status code, client IP, user agent, referer, request id, and timestamp

The same event is sent to the VPC backend at `POST /v1/roadmap/access-events` and persisted in `roadmap_access_events`. If backend persistence is unavailable, the route still emits the structured application log and writes a warning with the audit failure reason.

## Public repo pieces

- `lib/dashboard-catalog.ts` contains the shared dashboard registry used by the home page and private dashboard nav shell.
- `app/page.tsx` renders the home-page cards from the shared catalog and makes this the first dashboard card.
- `app/private-dashboard-shell.tsx` renders the parent-app nav shell around private HTML dashboards.
- `app/zodl-roadmap/page.tsx` renders the shared shell.
- `app/zodl-roadmap/content/route.ts` enforces viewer access and returns the private HTML.
- `app/zodl-roadmap/[...assetPath]/route.ts` serves authenticated sibling assets from the private repo.
- `lib/roadmap-access-events.ts` records user-based roadmap access audit events.
- `lib/private-dashboard-content.ts` reads the configured HTML file.
- `lib/private-dashboard-response.ts` centralizes private HTML and asset response behavior.
- `next.config.ts` includes `.private/zodl-roadmap/**/*` in the server file trace for the route.
- `.gitignore` excludes `.private/` so private content is not committed here.
- `amplify.yml` optionally checks out the private repo during Amplify `preBuild`.

## Private repo layout

Create a private GitHub repo, for example `paulbrigner/zodl-roadmap-private`, with this minimal layout:

```text
zodl-roadmap-private/
  index.html
  README.md
```

For now, keep `index.html` mostly self-contained. Inline CSS is fine. Relative sibling assets can be served through the authenticated `/<dashboard>/<assetPath>` proxy route when the private repo includes them.

One way to create it:

```bash
mkdir zodl-roadmap-private
cd zodl-roadmap-private
printf '%s\n' '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zodl Roadmap</title></head><body></body></html>' > index.html
git init
git add index.html
git commit -m "Add private roadmap HTML shell"
gh repo create paulbrigner/zodl-roadmap-private --private --source=. --remote=origin --push
```

## Local development link

From the public `zodldashboard` checkout, place or clone the private repo at:

```text
.private/zodl-roadmap/index.html
```

That is the default path read by `/zodl-roadmap/content`. To use another path locally, set:

```env
ZODL_ROADMAP_HTML_PATH=/absolute/path/to/index.html
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
ZODL_ROADMAP_PRIVATE_REPO=git@github.com:paulbrigner/zodl-roadmap-private.git
ZODL_ROADMAP_DEPLOY_KEY_B64=<base64-encoded-private-half-of-read-only-github-deploy-key>
ZODL_ROADMAP_PRIVATE_BRANCH=main
```

Use a read-only GitHub deploy key scoped only to the private roadmap repo. A fine-grained GitHub token or machine-user token can be used as a fallback with `ZODL_ROADMAP_GITHUB_TOKEN`, but the deploy key is preferred because it is narrower.

During Amplify `preBuild`, `amplify.yml` writes a temporary SSH private key from `ZODL_ROADMAP_DEPLOY_KEY_B64`, clones the private repo into `.private/zodl-roadmap`, then removes the temporary key. If a deploy key is not configured but `ZODL_ROADMAP_GITHUB_TOKEN` is present, it falls back to a temporary `~/.netrc` HTTPS clone. `next build` then traces the private HTML into the server bundle because `next.config.ts` includes `.private/zodl-roadmap/**/*` for `/zodl-roadmap`.

`ZODL_ROADMAP_HTML_PATH` does not need to be set in Amplify when using the default `.private/zodl-roadmap/index.html` path.

Prefer setting the Amplify variables in the Amplify console so existing production secrets are not accidentally overwritten. If using the AWS CLI, fetch the existing branch environment variables first, merge in the three roadmap variables, then call `update-branch` with the full merged map.

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

If the private repo is not configured or the private `index.html` is absent, `/zodl-roadmap/content` returns a private `503` placeholder page inside the shared shell to authenticated workspace/local-bypass users. Guest users are still redirected before any content lookup.
