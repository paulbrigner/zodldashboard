# X Monitor Core

This package is the first in-place extraction boundary for X Monitor. It owns
framework-agnostic public read contracts, URL serialization, and an injected
HTTP read client.

It deliberately does not own:

- authentication, authorization, membership, or access logging;
- Next.js routes, React components, navigation, branding, or CSS;
- PostgreSQL access or direct-database fallback;
- semantic embeddings, Answer Mode, email, or scheduled jobs;
- collectors, Lambda handlers, AWS provisioning, secrets, or production data.

`zodldashboard` remains the production host and backend owner during this
phase. The package is private and resolved through the repository TypeScript
alias until a separately versioned distribution location and owned npm scope
are selected. Consumers outside this repository must not copy or depend on
this source path; cross-repository consumption is a later extraction phase.
