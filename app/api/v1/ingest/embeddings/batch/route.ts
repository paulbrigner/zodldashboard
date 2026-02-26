import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { upsertEmbeddings } from "@/lib/xmonitor/repository";
import { parseBatchItems, parseEmbeddingUpsert } from "@/lib/xmonitor/validators";
import type { BatchUpsertResult, EmbeddingUpsert } from "@/lib/xmonitor/types";

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

  const received = parsedBatch.items.length;
  const validItems: EmbeddingUpsert[] = [];
  const validIndices: number[] = [];

  const baseResult: BatchUpsertResult = {
    received,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  parsedBatch.items.forEach((item, index) => {
    const parsed = parseEmbeddingUpsert(item);
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
    const dbResult = await upsertEmbeddings(validItems);

    return jsonOk({
      received: baseResult.received,
      inserted: dbResult.inserted,
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
    return jsonError(error instanceof Error ? error.message : "failed to upsert embeddings", 503);
  }
}
