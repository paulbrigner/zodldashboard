import {
  archiveExecutionTrackerItem,
  executionTrackerStatus,
  updateExecutionTrackerItem,
} from "@/lib/execution-tracker";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import type { ExecutionTrackerUpdatePayload } from "@/lib/execution-tracker-types";

export const runtime = "nodejs";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const { itemId } = await context.params;
  if (!itemId) {
    return jsonError("itemId is required", 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const updatePayload: ExecutionTrackerUpdatePayload = {
    dashboardId: stringValue(body.dashboard_id || body.dashboardId),
    boardKey: stringValue(body.board_key || body.boardKey),
    title: stringValue(body.title),
    description: body.description === null ? null : stringValue(body.description),
    statusKey: stringValue(body.status_key || body.statusKey),
    assignee: body.assignee === null ? null : stringValue(body.assignee),
    dueDate: (body.due_date || body.dueDate) === null ? null : stringValue(body.due_date || body.dueDate),
    labels: Array.isArray(body.labels) ? body.labels.filter((entry): entry is string => typeof entry === "string") : undefined,
    links: Array.isArray(body.links) ? body.links as ExecutionTrackerUpdatePayload["links"] : undefined,
    beforeItemId: (body.before_item_id || body.beforeItemId) === null ? null : stringValue(body.before_item_id || body.beforeItemId),
    afterItemId: (body.after_item_id || body.afterItemId) === null ? null : stringValue(body.after_item_id || body.afterItemId),
    expectedVersion: numberValue(body.expected_version || body.expectedVersion),
  };

  try {
    const item = await updateExecutionTrackerItem(viewer, itemId, updatePayload);
    return jsonOk({ item });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to update execution tracker item",
      executionTrackerStatus(error, 503)
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const { itemId } = await context.params;
  if (!itemId) {
    return jsonError("itemId is required", 400);
  }

  try {
    const item = await archiveExecutionTrackerItem(viewer, itemId);
    return jsonOk({ item });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to archive execution tracker item",
      executionTrackerStatus(error, 503)
    );
  }
}
