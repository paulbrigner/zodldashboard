#!/usr/bin/env node
// Rebuild one explicit historical window without collecting posts or moving cursors.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { buildWindowSummaryRecord, getConfig } from '../../services/x-api-collector-lambda/index.mjs';

const { values } = parseArgs({ options: {
  'window-type': { type: 'string' }, 'window-end': { type: 'string' },
  profile: { type: 'string', default: 'zodldashboard' },
  region: { type: 'string', default: 'us-east-1' },
  apply: { type: 'boolean', default: false },
} });
const hours = { rolling_2h: 2, rolling_12h: 12, rolling_7d_daily: 168 };
const type = values['window-type'];
const end = values['window-end'];
if (!hours[type] || !end || !/(Z|[+-]\d{2}:\d{2})$/.test(end)
    || !Number.isFinite(Date.parse(end)) || Date.parse(end) > Date.now()) {
  throw new Error('Provide --window-type rolling_2h|rolling_12h|rolling_7d_daily and an explicit past --window-end with timezone.');
}
const scope = { window_type: type, window_start: new Date(Date.parse(end) - hours[type] * 3600000).toISOString(),
  window_end: new Date(end).toISOString(), apply: values.apply };
console.log(JSON.stringify(scope));
if (values.apply) {
  // Credentials remain in memory; no environment values are printed or written.
  const configResponse = JSON.parse(execFileSync('aws', ['--profile', values.profile, '--region', values.region,
    'lambda', 'get-function-configuration', '--function-name', 'xmonitor-xapi-discovery-collector', '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  Object.assign(process.env, configResponse.Environment.Variables);
  const config = getConfig();
  const topPosts = { rolling_2h: config.summaryTopPosts2h, rolling_12h: config.summaryTopPosts12h,
    rolling_7d_daily: config.summaryTopPosts7d }[type];
  const built = await buildWindowSummaryRecord(config, type, hours[type], topPosts, end);
  console.log(JSON.stringify(built.metrics));
  if (built.metrics.llm_error || built.metrics.fetch_truncated || !built.metrics.llm_model) {
    throw new Error('Refusing to store an incomplete feed or non-AI fallback summary.');
  }
  const response = await fetch(`${config.ingestApiBaseUrl}/ingest/window-summaries/batch`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.ingestTimeoutMs),
    headers: { 'content-type': 'application/json', 'x-api-key': config.ingestApiKey },
    body: JSON.stringify({ items: [built.item] }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length || (Number(result.inserted || 0) + Number(result.updated || 0)) !== 1) {
    throw new Error(`Summary ingestion failed: ${response.status} ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ persisted: true, result }));
}
