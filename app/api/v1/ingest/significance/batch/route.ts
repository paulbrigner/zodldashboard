import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { applySignificanceResults } from "@/lib/xmonitor/repository";
import { parseBatchItems, parseSignificanceResultUpsert } from "@/lib/xmonitor/validators";
import type { SignificanceBatchResult, SignificanceResultUpsert } from "@/lib/xmonitor/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireIngestAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const parsedBatch = parseBatchItems(payload);
  if (!parsedBatch.ok) {
    return jsonError(parsedBatch.error, 400);
  }

  const validItems: SignificanceResultUpsert[] = [];
  const validIndices: number[] = [];
  const baseResult: SignificanceBatchResult = {
    received: parsedBatch.items.length,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  parsedBatch.items.forEach((item, index) => {
    const parsed = parseSignificanceResultUpsert(item);
    if (!parsed.ok) {
      baseResult.skipped += 1;
      baseResult.errors.push({ index, message: parsed.error });
      return;
    }

    validItems.push(parsed.data);
    validIndices.push(index);
  });

  if (validItems.length === 0) {
    return jsonOk(baseResult);
  }

  try {
    ensureDatabaseConfigured();
    const dbResult = await applySignificanceResults(validItems);
    return jsonOk({
      received: baseResult.received,
      updated: dbResult.updated,
      skipped: baseResult.skipped + dbResult.skipped,
      errors: [
        ...baseResult.errors,
        ...dbResult.errors.map((error) => ({
          index: validIndices[error.index] ?? error.index,
          message: error.message,
        })),
      ],
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to apply significance results", 503);
  }
}
