import { canAccessDashboard, findExecutionTrackerDashboard } from "@/lib/dashboard-catalog";
import {
  dashboardTrackPermission,
  hasAccessPermission,
  type EffectiveAccess,
} from "@/lib/access-control";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { getDbPool } from "@/lib/xmonitor/db";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";
import type { ViewerAccessLevel } from "@/lib/viewer-access";
import type {
  ExecutionTrackerCreatePayload,
  ExecutionTrackerItem,
  ExecutionTrackerLink,
  ExecutionTrackerState,
  ExecutionTrackerStatus,
  ExecutionTrackerUpdatePayload,
} from "@/lib/execution-tracker-types";

type ExecutionTrackerViewer = {
  email: string;
  authMode?: "oauth" | "local-bypass";
  mode?: "oauth" | "local-bypass";
  accessLevel: ViewerAccessLevel;
  permissions?: EffectiveAccess["permissions"];
};

type BoardRow = {
  dashboard_id: string;
  board_key: string;
  title: string;
  status_config: unknown;
  enabled: boolean;
};

type ItemRow = {
  item_id: string;
  dashboard_id: string;
  board_key: string;
  title: string;
  description: string | null;
  status_key: string;
  position: string | number;
  assignee: string | null;
  due_date: string | Date | null;
  labels: unknown;
  links: unknown;
  created_by: string;
  updated_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
  version: number;
};

type ItemSnapshot = {
  title: string;
  description: string | null;
  statusKey: string;
  position: number;
  assignee: string | null;
  dueDate: string | null;
  labels: string[];
  links: ExecutionTrackerLink[];
  version: number;
  archivedAt: string | null;
};

export const DEFAULT_EXECUTION_TRACKER_STATUSES: ExecutionTrackerStatus[] = [
  { key: "not-started", label: "Not Yet Started" },
  { key: "in-progress", label: "In Progress" },
  { key: "drafting", label: "Drafting" },
  { key: "reviewing", label: "Reviewing" },
  { key: "finalizing", label: "Finalizing" },
  { key: "publishing", label: "Publishing" },
  { key: "complete", label: "Complete", terminal: true },
];

const DEFAULT_BOARD_KEY = "default";

class ExecutionTrackerError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeDashboardId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeBoardKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key || DEFAULT_BOARD_KEY;
}

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function requiredTitle(value: unknown): string {
  const title = textValue(value, 240);
  if (!title) throw new ExecutionTrackerError(400, "title is required");
  return title;
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ExecutionTrackerError(400, "due_date must use YYYY-MM-DD");
  }
  return trimmed;
}

function listValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => textValue(entry, 48))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 12);
}

function linksValue(value: unknown): ExecutionTrackerLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const url = textValue(record.url, 1000);
      if (!url) return null;
      const label = textValue(record.label, 120) || url;
      return { label, url };
    })
    .filter((entry): entry is ExecutionTrackerLink => Boolean(entry))
    .slice(0, 8);
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function dateOnlyOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function statusList(value: unknown): ExecutionTrackerStatus[] {
  if (!Array.isArray(value)) return DEFAULT_EXECUTION_TRACKER_STATUSES;
  const statuses = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const key = textValue(record.key, 80);
      const label = textValue(record.label, 120);
      if (!key || !label) return null;
      const status: ExecutionTrackerStatus = { key, label };
      if (record.terminal === true) status.terminal = true;
      return status;
    })
    .filter((entry): entry is ExecutionTrackerStatus => Boolean(entry));
  return statuses.length ? statuses : DEFAULT_EXECUTION_TRACKER_STATUSES;
}

function rowToItem(row: ItemRow): ExecutionTrackerItem {
  return {
    itemId: String(row.item_id),
    dashboardId: row.dashboard_id,
    boardKey: row.board_key,
    title: row.title,
    description: row.description || null,
    statusKey: row.status_key,
    position: Number(row.position),
    assignee: row.assignee || null,
    dueDate: dateOnlyOrNull(row.due_date),
    labels: listValue(row.labels),
    links: linksValue(row.links),
    createdBy: row.created_by,
    updatedBy: row.updated_by || null,
    createdAt: isoOrNull(row.created_at) || new Date().toISOString(),
    updatedAt: isoOrNull(row.updated_at) || new Date().toISOString(),
    archivedAt: isoOrNull(row.archived_at),
    version: Number(row.version || 1),
  };
}

function snapshotFromItem(item: ExecutionTrackerItem): ItemSnapshot {
  return {
    title: item.title,
    description: item.description,
    statusKey: item.statusKey,
    position: item.position,
    assignee: item.assignee,
    dueDate: item.dueDate,
    labels: item.labels,
    links: item.links,
    version: item.version,
    archivedAt: item.archivedAt,
  };
}

function trackerDashboard(viewer: ExecutionTrackerViewer, dashboardId: string) {
  const dashboard = findExecutionTrackerDashboard(normalizeDashboardId(dashboardId));
  if (!dashboard) {
    throw new ExecutionTrackerError(400, "dashboard does not support execution tracking");
  }
  if (!canAccessDashboard(dashboard, { accessLevel: viewer.accessLevel, email: viewer.email, permissions: viewer.permissions || [] })) {
    throw new ExecutionTrackerError(403, "dashboard access required");
  }
  return dashboard;
}

function canEditExecutionTracker(viewer: ExecutionTrackerViewer, dashboardId: string): boolean {
  if (viewer.accessLevel === "local-bypass") return true;
  return hasAccessPermission({ permissions: viewer.permissions || [] }, dashboardTrackPermission(dashboardId));
}

function requireTrackerEdit(viewer: ExecutionTrackerViewer, dashboardId: string) {
  if (!canEditExecutionTracker(viewer, dashboardId)) {
    throw new ExecutionTrackerError(403, "execution tracker edit permission required");
  }
}

function assertStatus(statuses: ExecutionTrackerStatus[], statusKey: string): string {
  const normalized = textValue(statusKey, 80);
  if (!normalized || !statuses.some((status) => status.key === normalized)) {
    throw new ExecutionTrackerError(400, "status_key is invalid");
  }
  return normalized;
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

async function fetchBackendJson<T>(path: string, viewer: ExecutionTrackerViewer, init: RequestInit = {}): Promise<T | null> {
  const backendBase = backendApiBaseUrl();
  const viewerHeaders = buildViewerProxyHeaders(viewer);
  if (!backendBase || !viewerHeaders) return null;

  const response = await fetch(`${backendBase}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...viewerHeaders,
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new ExecutionTrackerError(response.status, body?.error || `execution tracker request failed with ${response.status}`);
  }
  return body;
}

export function executionTrackerStatus(error: unknown, fallback = 503): number {
  return error instanceof ExecutionTrackerError ? error.status : fallback;
}

async function ensureDirectBoard(
  dashboardId: string,
  boardKey: string,
  actorEmail: string
): Promise<BoardRow> {
  const result = await getDbPool().query<BoardRow>(
    `
      INSERT INTO execution_tracker_boards(dashboard_id, board_key, title, status_config, created_by)
      VALUES ($1, $2, 'Execution Tracker', $3::jsonb, $4)
      ON CONFLICT (dashboard_id, board_key)
      DO UPDATE SET dashboard_id = EXCLUDED.dashboard_id
      RETURNING dashboard_id, board_key, title, status_config, enabled
    `,
    [dashboardId, boardKey, JSON.stringify(DEFAULT_EXECUTION_TRACKER_STATUSES), actorEmail]
  );
  return result.rows[0];
}

async function directTrackerState(
  viewer: ExecutionTrackerViewer,
  dashboardId: string,
  boardKey = DEFAULT_BOARD_KEY
): Promise<ExecutionTrackerState> {
  if (!hasDatabaseConfig()) {
    throw new ExecutionTrackerError(503, "execution tracker database is not configured");
  }
  const dashboard = trackerDashboard(viewer, dashboardId);
  const normalizedBoardKey = normalizeBoardKey(boardKey);
  try {
    const board = await ensureDirectBoard(dashboard.id, normalizedBoardKey, viewer.email);
    const statuses = statusList(board.status_config);
    const items = await getDbPool().query<ItemRow>(
      `
        SELECT item_id, dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by, created_at, updated_at, archived_at, version
        FROM execution_tracker_items
        WHERE dashboard_id = $1 AND board_key = $2 AND archived_at IS NULL
        ORDER BY status_key, position, created_at
      `,
      [dashboard.id, normalizedBoardKey]
    );
    return {
      dashboardId: dashboard.id,
      dashboardName: dashboard.name,
      boardKey: normalizedBoardKey,
      title: board.title,
      statuses,
      items: items.rows.map(rowToItem),
      canEdit: canEditExecutionTracker(viewer, dashboard.id),
      available: board.enabled,
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new ExecutionTrackerError(503, "execution tracker schema has not been migrated");
    }
    throw error;
  }
}

async function positionForMove(
  client: Pick<ReturnType<typeof getDbPool>, "query">,
  dashboardId: string,
  boardKey: string,
  statusKey: string,
  beforeItemId: string | null,
  afterItemId: string | null,
  excludedItemId: string | null
): Promise<number> {
  if (beforeItemId || afterItemId) {
    const ids = [beforeItemId, afterItemId].filter(Boolean);
    const neighborValues: unknown[] = [dashboardId, boardKey, statusKey, ids];
    const excludedClause = excludedItemId ? `AND item_id <> $${neighborValues.push(excludedItemId)}` : "";
    const neighborResult = await client.query<{ item_id: string; position: string | number }>(
      `
        SELECT item_id, position
        FROM execution_tracker_items
        WHERE dashboard_id = $1 AND board_key = $2 AND status_key = $3 AND archived_at IS NULL
          AND item_id = ANY($4::uuid[])
          ${excludedClause}
      `,
      neighborValues
    );
    const byId = new Map(neighborResult.rows.map((row) => [row.item_id, Number(row.position)]));
    const beforePosition = beforeItemId ? byId.get(beforeItemId) : undefined;
    const afterPosition = afterItemId ? byId.get(afterItemId) : undefined;
    if (beforeItemId && beforePosition === undefined) {
      throw new ExecutionTrackerError(400, "before_item_id is invalid");
    }
    if (afterItemId && afterPosition === undefined) {
      throw new ExecutionTrackerError(400, "after_item_id is invalid");
    }
    if (beforePosition !== undefined && afterPosition !== undefined) {
      return (beforePosition + afterPosition) / 2;
    }
    if (beforePosition !== undefined) return beforePosition + 1000;
    if (afterPosition !== undefined) return afterPosition > 1 ? afterPosition / 2 : afterPosition - 1000;
  }

  const values: unknown[] = [dashboardId, boardKey, statusKey];
  const excludedClause = excludedItemId ? `AND item_id <> $${values.push(excludedItemId)}` : "";
  const result = await client.query<{ position: string | number }>(
    `
      SELECT COALESCE(MAX(position), 0) + 1000 AS position
      FROM execution_tracker_items
      WHERE dashboard_id = $1 AND board_key = $2 AND status_key = $3 AND archived_at IS NULL
        ${excludedClause}
    `,
    values
  );
  return Number(result.rows[0]?.position || 1000);
}

async function recordDirectEvent(
  client: Pick<ReturnType<typeof getDbPool>, "query">,
  itemId: string | null,
  dashboardId: string,
  boardKey: string,
  actorEmail: string,
  action: "created" | "updated" | "moved" | "archived" | "restored",
  before: ItemSnapshot | null,
  after: ItemSnapshot | null
) {
  await client.query(
    `
      INSERT INTO execution_tracker_item_events(item_id, dashboard_id, board_key, actor_email, action, before_json, after_json)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    `,
    [
      itemId,
      dashboardId,
      boardKey,
      actorEmail,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ]
  );
}

async function directCreateTrackerItem(
  viewer: ExecutionTrackerViewer,
  payload: ExecutionTrackerCreatePayload
): Promise<ExecutionTrackerItem> {
  if (!hasDatabaseConfig()) {
    throw new ExecutionTrackerError(503, "execution tracker database is not configured");
  }
  const dashboard = trackerDashboard(viewer, payload.dashboardId);
  requireTrackerEdit(viewer, dashboard.id);
  const boardKey = normalizeBoardKey(payload.boardKey);
  const title = requiredTitle(payload.title);
  const description = textValue(payload.description, 4000);
  const assignee = textValue(payload.assignee, 120);
  const dueDate = dateValue(payload.dueDate);
  const labels = listValue(payload.labels);
  const links = linksValue(payload.links);
  const beforeItemId = textValue(payload.beforeItemId, 80);
  const afterItemId = textValue(payload.afterItemId, 80);

  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const board = await ensureDirectBoard(dashboard.id, boardKey, viewer.email);
    const statuses = statusList(board.status_config);
    const statusKey = assertStatus(statuses, payload.statusKey || statuses[0].key);
    const position = await positionForMove(client, dashboard.id, boardKey, statusKey, beforeItemId, afterItemId, null);
    const result = await client.query<ItemRow>(
      `
        INSERT INTO execution_tracker_items(
          dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::jsonb, $10::jsonb, $11, $11)
        RETURNING item_id, dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by, created_at, updated_at, archived_at, version
      `,
      [
        dashboard.id,
        boardKey,
        title,
        description,
        statusKey,
        position,
        assignee,
        dueDate,
        JSON.stringify(labels),
        JSON.stringify(links),
        viewer.email,
      ]
    );
    const item = rowToItem(result.rows[0]);
    await recordDirectEvent(client, item.itemId, dashboard.id, boardKey, viewer.email, "created", null, snapshotFromItem(item));
    await client.query("COMMIT");
    return item;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isMissingTableError(error)) {
      throw new ExecutionTrackerError(503, "execution tracker schema has not been migrated");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function directUpdateTrackerItem(
  viewer: ExecutionTrackerViewer,
  itemId: string,
  payload: ExecutionTrackerUpdatePayload
): Promise<ExecutionTrackerItem> {
  if (!hasDatabaseConfig()) {
    throw new ExecutionTrackerError(503, "execution tracker database is not configured");
  }
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query<ItemRow>(
      `
        SELECT item_id, dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by, created_at, updated_at, archived_at, version
        FROM execution_tracker_items
        WHERE item_id = $1
        FOR UPDATE
      `,
      [itemId]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow || existingRow.archived_at) {
      throw new ExecutionTrackerError(404, "tracker item not found");
    }
    const existing = rowToItem(existingRow);
    const dashboard = trackerDashboard(viewer, existing.dashboardId);
    requireTrackerEdit(viewer, dashboard.id);
    if (payload.dashboardId && normalizeDashboardId(payload.dashboardId) !== dashboard.id) {
      throw new ExecutionTrackerError(400, "dashboard_id does not match item");
    }
    if (payload.boardKey && normalizeBoardKey(payload.boardKey) !== existing.boardKey) {
      throw new ExecutionTrackerError(400, "board_key does not match item");
    }
    if (payload.expectedVersion && payload.expectedVersion !== existing.version) {
      throw new ExecutionTrackerError(409, "tracker item was changed by someone else");
    }

    const board = await ensureDirectBoard(dashboard.id, existing.boardKey, viewer.email);
    const statuses = statusList(board.status_config);
    const nextStatusKey = payload.statusKey ? assertStatus(statuses, payload.statusKey) : existing.statusKey;
    const beforeItemId = textValue(payload.beforeItemId, 80);
    const afterItemId = textValue(payload.afterItemId, 80);
    const moveRequested = payload.statusKey !== undefined || beforeItemId !== null || afterItemId !== null;
    const nextPosition = moveRequested
      ? await positionForMove(client, dashboard.id, existing.boardKey, nextStatusKey, beforeItemId, afterItemId, itemId)
      : existing.position;
    const nextTitle = payload.title !== undefined ? requiredTitle(payload.title) : existing.title;
    const nextDescription = payload.description !== undefined ? textValue(payload.description, 4000) : existing.description;
    const nextAssignee = payload.assignee !== undefined ? textValue(payload.assignee, 120) : existing.assignee;
    const nextDueDate = payload.dueDate !== undefined ? dateValue(payload.dueDate) : existing.dueDate;
    const nextLabels = payload.labels !== undefined ? listValue(payload.labels) : existing.labels;
    const nextLinks = payload.links !== undefined ? linksValue(payload.links) : existing.links;

    const result = await client.query<ItemRow>(
      `
        UPDATE execution_tracker_items
        SET title = $2,
            description = $3,
            status_key = $4,
            position = $5,
            assignee = $6,
            due_date = $7::date,
            labels = $8::jsonb,
            links = $9::jsonb,
            updated_by = $10,
            version = version + 1
        WHERE item_id = $1
        RETURNING item_id, dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by, created_at, updated_at, archived_at, version
      `,
      [
        itemId,
        nextTitle,
        nextDescription,
        nextStatusKey,
        nextPosition,
        nextAssignee,
        nextDueDate,
        JSON.stringify(nextLabels),
        JSON.stringify(nextLinks),
        viewer.email,
      ]
    );
    const item = rowToItem(result.rows[0]);
    const action = existing.statusKey !== item.statusKey || existing.position !== item.position ? "moved" : "updated";
    await recordDirectEvent(
      client,
      item.itemId,
      dashboard.id,
      item.boardKey,
      viewer.email,
      action,
      snapshotFromItem(existing),
      snapshotFromItem(item)
    );
    await client.query("COMMIT");
    return item;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isMissingTableError(error)) {
      throw new ExecutionTrackerError(503, "execution tracker schema has not been migrated");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function directArchiveTrackerItem(viewer: ExecutionTrackerViewer, itemId: string): Promise<ExecutionTrackerItem> {
  if (!hasDatabaseConfig()) {
    throw new ExecutionTrackerError(503, "execution tracker database is not configured");
  }
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query<ItemRow>(
      `
        SELECT item_id, dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by, created_at, updated_at, archived_at, version
        FROM execution_tracker_items
        WHERE item_id = $1
        FOR UPDATE
      `,
      [itemId]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow || existingRow.archived_at) {
      throw new ExecutionTrackerError(404, "tracker item not found");
    }
    const existing = rowToItem(existingRow);
    const dashboard = trackerDashboard(viewer, existing.dashboardId);
    requireTrackerEdit(viewer, dashboard.id);
    const result = await client.query<ItemRow>(
      `
        UPDATE execution_tracker_items
        SET archived_at = now(),
            updated_by = $2,
            version = version + 1
        WHERE item_id = $1
        RETURNING item_id, dashboard_id, board_key, title, description, status_key, position, assignee, due_date,
          labels, links, created_by, updated_by, created_at, updated_at, archived_at, version
      `,
      [itemId, viewer.email]
    );
    const item = rowToItem(result.rows[0]);
    await recordDirectEvent(
      client,
      item.itemId,
      dashboard.id,
      item.boardKey,
      viewer.email,
      "archived",
      snapshotFromItem(existing),
      snapshotFromItem(item)
    );
    await client.query("COMMIT");
    return item;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isMissingTableError(error)) {
      throw new ExecutionTrackerError(503, "execution tracker schema has not been migrated");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getExecutionTrackerState(
  viewer: ExecutionTrackerViewer,
  dashboardId: string,
  boardKey = DEFAULT_BOARD_KEY
): Promise<ExecutionTrackerState> {
  const dashboard = trackerDashboard(viewer, dashboardId);
  const normalizedBoardKey = normalizeBoardKey(boardKey);
  const backend = await fetchBackendJson<ExecutionTrackerState>(
    `/execution-tracker?dashboard_id=${encodeURIComponent(dashboard.id)}&board_key=${encodeURIComponent(normalizedBoardKey)}`,
    viewer
  );
  if (backend) return backend;
  return directTrackerState(viewer, dashboard.id, normalizedBoardKey);
}

export async function createExecutionTrackerItem(
  viewer: ExecutionTrackerViewer,
  payload: ExecutionTrackerCreatePayload
): Promise<ExecutionTrackerItem> {
  const dashboard = trackerDashboard(viewer, payload.dashboardId);
  requireTrackerEdit(viewer, dashboard.id);
  const backend = await fetchBackendJson<{ item: ExecutionTrackerItem }>("/execution-tracker/items", viewer, {
    method: "POST",
    body: JSON.stringify({ ...payload, dashboard_id: dashboard.id, board_key: normalizeBoardKey(payload.boardKey) }),
  });
  if (backend?.item) return backend.item;
  return directCreateTrackerItem(viewer, { ...payload, dashboardId: dashboard.id });
}

export async function updateExecutionTrackerItem(
  viewer: ExecutionTrackerViewer,
  itemId: string,
  payload: ExecutionTrackerUpdatePayload
): Promise<ExecutionTrackerItem> {
  const backend = await fetchBackendJson<{ item: ExecutionTrackerItem }>(
    `/execution-tracker/items/${encodeURIComponent(itemId)}`,
    viewer,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
  if (backend?.item) return backend.item;
  return directUpdateTrackerItem(viewer, itemId, payload);
}

export async function archiveExecutionTrackerItem(
  viewer: ExecutionTrackerViewer,
  itemId: string
): Promise<ExecutionTrackerItem> {
  const backend = await fetchBackendJson<{ item: ExecutionTrackerItem }>(
    `/execution-tracker/items/${encodeURIComponent(itemId)}`,
    viewer,
    { method: "DELETE" }
  );
  if (backend?.item) return backend.item;
  return directArchiveTrackerItem(viewer, itemId);
}
