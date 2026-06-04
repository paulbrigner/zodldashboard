# Agent Instructions

This repository owns the public authenticated `zodldashboard` app, including auth, dashboard routing, access policy, access logging, Amplify build integration, API proxy routes, and deployment.

## Private Dashboard Pattern

Use this checklist when adding another private dashboard with its own content repo.

1. Keep app access and repo access separate.
   - `zodldashboard` owns viewer auth, dashboard cards, route access checks, route logging, and deployment.
   - The private content repo owns collaborator-editable HTML/JS only.
   - Do not give a content collaborator access to unrelated private repos or to this public app repo unless the user explicitly asks.
2. Create the private content repo under `paulbrigner` unless instructed otherwise.
   - Use a self-contained `index.html`.
   - Include `<link rel="icon" href="/icon.svg" type="image/svg+xml">` in the private HTML head so the private dashboard uses the same browser icon as the main dashboard and X Monitor.
   - Add `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/ZODLDASHBOARD_INTEGRATION.md`.
   - Ignore secrets, deploy keys, `.env` files, scratch files, and generated artifacts.
3. Add the public app route.
   - Use a stable route slug such as `/arktouros`.
   - Read from `.private/<slug>/index.html` by default, with an optional `<PREFIX>_HTML_PATH` env override.
   - Return private HTML with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.
   - Return a private `503` placeholder for authenticated allowed users when content is missing.
4. Add route-specific access policy.
   - Plain guests from `ALLOWED_GUEST_GOOGLE_EMAILS` should remain X Monitor-only unless the user explicitly changes that boundary.
   - Workspace users, local-bypass users, and currently dashboard-authorized roadmap guests can access private dashboards by default.
   - For each new dashboard, add a separate optional allowlist such as `ALLOWED_ARKTOUROS_GUEST_EMAILS` so future dashboard-specific access can be granted without changing the general guest list.
5. Add route-specific access logging.
   - Log by authenticated viewer identity, not only edge/CDN metadata.
   - Reuse the `roadmap_access_events` path-based audit table unless a new persistence model is explicitly requested.
6. Wire Amplify.
   - Clone the private repo during `preBuild` into `.private/<slug>`.
   - Prefer a read-only deploy key scoped only to that private repo.
   - Add a `next.config.ts` file trace include for `.private/<slug>/**/*`.
   - Merge new Amplify environment variables into the existing branch env map; do not overwrite existing secrets.
7. Document the integration in `docs/<DASHBOARD>_PRIVATE_DASHBOARD.md`.
8. Verify before reporting done.
   - Run `git diff --check`.
   - Run `npm run typecheck`.
   - Push the private repo and the public app changes.
   - Trigger the production Amplify release only when the user requested a deployed integration.
   - Poll the Amplify job to a terminal state and smoke-check the route.

## Current Private Dashboard Docs

- `docs/ZODL_ROADMAP_PRIVATE_DASHBOARD.md`
- `docs/PGPZ_ROADMAP_PRIVATE_DASHBOARD.md`
- `docs/ARKTOUROS_PRIVATE_DASHBOARD.md`
