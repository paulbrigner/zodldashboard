# Future Work

This file captures potential follow-up work and staged initiatives that are not yet complete.

## Evaluate X Monitor Repository Extraction

Status: phase 1 in progress. See [X Monitor Targeted Extraction](X_MONITOR_EXTRACTION.md).

Consider separating X Monitor from `zodldashboard` into its own application/service repository.

Rationale:

- reduce coupling between the authenticated dashboard portal and the X Monitor product code;
- make X Monitor easier to maintain, test, and reason about independently;
- support cleaner collaborator access boundaries;
- make a future open-source X Monitor distribution more plausible by separating generic product code from Zodl-specific deployment, auth, secrets, and production operations.

Suggested target shape:

- `zodldashboard` continues to own authentication, the dashboard landing page, access policy, and links/proxies to hosted tools.
- A future `xmonitor` repo owns the X Monitor UI, API/backend, database schema/migrations, collector and Lambda tooling, OpenAPI docs, local/dev setup, and open-source-safe examples.

Notes for a future implementation:

- Treat this as a staged extraction, not a quick file move.
- First modularize X Monitor boundaries in place. The headless read
  contracts/client and zodldashboard read adapter are now implemented.
- Preserve the existing production route and access behavior during any migration.
- Keep private AWS account details, production data, secrets, allowlists, and Zodl-specific operations out of any open-source distribution.
