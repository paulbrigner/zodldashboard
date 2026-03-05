# AWS Cost Reporting for ZodlDashboard

This document describes how to tag ZodlDashboard/XMonitor AWS resources and run an on-demand cost report from AWS Cost Explorer.

## 1) One-time setup

Apply tags and activate the cost-allocation tag:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
./scripts/aws/setup_zodldashboard_cost_tags.sh
```

Default tag key/value:

- `Project=ZodlDashboard`

The setup script tags known resources used by this app, including:

- Amplify app
- API Gateway HTTP API
- XMonitor Lambda functions
- EventBridge schedules
- SQS queues
- CloudWatch log groups for Lambda functions
- RDS instance
- Secrets Manager secret
- EC2 network resources used by the VPC/Lambda path (NAT/route table/SG where discoverable by `Name` tag)

## 2) (Recommended) Backfill activation status

To include historical costs (up to 12 months), start a backfill:

```bash
BACKFILL_FROM="2025-03-01T00:00:00Z"
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
aws ce start-cost-allocation-tag-backfill --backfill-from "$BACKFILL_FROM"
```

You can check history/status:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
aws ce list-cost-allocation-tag-backfill-history --output table
```

## 3) Run report on demand

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
./scripts/aws/report_zodldashboard_costs.sh
```

Defaults:

- date range: last 30 days through tomorrow (end date exclusive)
- group by: service (computed from daily tagged spend)
- output files:
  - `data/reports/aws-cost/zodldashboard_cost_summary_<timestamp>.json`
  - `data/reports/aws-cost/zodldashboard_cost_raw_<timestamp>.json`

Optional overrides:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
COST_TAG_KEY=Project COST_TAG_VALUE=ZodlDashboard \
START_DATE=2026-03-01 END_DATE=2026-04-01 TOP_N_SERVICES=20 \
./scripts/aws/report_zodldashboard_costs.sh
```

## Notes

- Cost Explorer date range uses `Start` inclusive and `End` exclusive.
- AWS-only spend is included; non-AWS providers (for example X API and Venice) are not part of this report.
- Immediately after activating a tag, Cost Explorer can show `0` until tag processing/backfill finishes.
