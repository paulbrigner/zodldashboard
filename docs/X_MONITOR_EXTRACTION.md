# X Monitor Targeted Extraction

## Status

Phase 1 is implemented in place. Production ownership and behavior remain in
`zodldashboard` while a reusable, headless read boundary is characterized.

## Phase 1 boundary

`packages/x-monitor-core` owns:

- feed, summary, activity-trend, author-location, and post-detail
  contracts;
- stable query-string serialization for the protected read endpoints;
- an injected, framework-agnostic HTTP client with `no-store` reads, response
  validation, upstream error handling, and post-detail `404` handling.

`lib/xmonitor/read-service.ts` is the zodldashboard host adapter. It preserves
the existing selection between the hosted API and direct PostgreSQL and is now
used by both `/x-monitor` and `/posts/[statusId]`.

`zodldashboard` continues to own:

- authentication, dashboard permissions, redirects, and viewer access logs;
- the `/x-monitor`, `/posts/[statusId]`, and `/api/v1/*` routes;
- React UI, navigation, Zodl branding, and global styles;
- direct PostgreSQL access and repository queries;
- semantic search, Answer Mode, viewer identity forwarding, email, and
  scheduled jobs;
- collectors, classifier, Lambda handlers, migrations, AWS provisioning,
  secrets, production data, and operations.

This preserves the current production route and access behavior. The package
does not read environment variables and has no Next.js, React, PostgreSQL, or
AWS dependency.

## Distribution decision

The package name `@xmonitor/core` is provisional and private. During phase 1 it
is resolved through the repository TypeScript alias; it is not an npm workspace
or a cross-repository dependency. This avoids changing the root install and
Lambda packaging paths before the boundary is stable.

The active Community application is
`../pgpz-sites/apps/community`. The standalone `../pgpz-community` repository
is a production-cutover rollback baseline and must not receive new feature
work.

Before Community consumes this package, choose one reproducible distribution
mechanism:

1. move the package to a separately versioned X Monitor repository and publish
   compiled ESM plus declarations under an owned package scope; or
2. temporarily vendor a pinned source snapshot into `pgpz-sites/packages` with
   a recorded source commit and automated hash/sync verification.

A relative dependency on the zodldashboard checkout is not valid for Amplify.

## Community host boundary

Community should eventually own a native member route and same-origin backend
for frontend proxy. That proxy must:

- resolve the Community Better Auth session on every request;
- enforce the protected-content membership capability server-side;
- allowlist X Monitor read paths and methods;
- strip inbound identity and proxy-secret headers;
- inject a Community-specific `x-xmonitor-client-id` and
  `x-xmonitor-client-secret` from server-only configuration;
- return private, no-store responses.

The first Community integration should be read-only. Do not share the current
zodldashboard viewer proxy secret. Semantic search, Answer Mode, sending, and
schedules require issuer/audience-aware identity, tenant-scoped ownership, and
explicit capability claims before they can safely cross hosts. Community
magic-link sessions must not be mislabeled as Zodl OAuth sessions.

This is an intentional Community-only feature candidate; it does not imply a
Coalition implementation.

## Next phases

1. Characterize API/direct-database parity and finish read contract coverage.
2. Choose the package's independent versioning and distribution mechanism.
3. Add the authenticated, read-only Community proxy and consume the package in
   `pgpz-sites/apps/community` behind a disabled-by-default feature flag.
4. Extract the feed/trends presentation into scoped, host-configurable React
   components. Keep host navigation, identity text, and branding injected.
5. Replace the static viewer-secret/email trust model with tenant-aware signed
   identity and explicit capabilities before moving semantic, compose, email,
   or schedules.
6. Only then decide whether the X Monitor backend/collectors move to a separate
   service repository and whether the zodldashboard route remains, proxies, or
   is retired.

Do not combine `zodldashboard` and `pgpz-sites` into one monorepo during this
extraction. Their auth stores, deployment pipelines, Lambda packaging, and
operational blast radii remain materially different.
