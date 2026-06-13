import { canAccessDashboard, findUpdateNotificationDashboard } from "@/lib/dashboard-catalog";
import { getDbPool } from "@/lib/xmonitor/db";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";
import type { ViewerAccessLevel } from "@/lib/viewer-access";

type NotificationViewer = {
  email: string;
  authMode?: "oauth" | "local-bypass";
  mode?: "oauth" | "local-bypass";
  accessLevel: ViewerAccessLevel;
  permissions?: string[];
};

export type DashboardUpdateSubscriptionState = {
  dashboardId: string;
  dashboardName: string;
  email: string;
  enabled: boolean;
  available: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DashboardUpdatePublishPayload = {
  dashboardId: string;
  title?: string;
  summary?: string;
  url?: string;
  source?: "manual" | "api" | "github" | "admin";
  sourceRef?: string;
};

export type DashboardUpdatePublishResult = {
  event: {
    eventId: string;
    dashboardId: string;
    title: string;
    summary: string | null;
    url: string | null;
    source: string;
    sourceRef: string | null;
    createdBy: string;
    createdAt: string;
    notifiedAt: string | null;
    recipientCount: number;
    sentCount: number;
    failedCount: number;
  };
  deliveries: Array<{
    email: string;
    status: "sent" | "failed" | "skipped";
    deliveryId: string | null;
    errorMessage: string | null;
  }>;
};

class DashboardUpdateNotificationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeDashboardId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

function assertNotificationAccess(viewer: NotificationViewer, dashboardId: string) {
  const dashboard = findUpdateNotificationDashboard(normalizeDashboardId(dashboardId));
  if (!dashboard) {
    throw new DashboardUpdateNotificationError(400, "dashboard does not support update notifications");
  }
  if (!canAccessDashboard(dashboard, { accessLevel: viewer.accessLevel, email: viewer.email, permissions: viewer.permissions || [] })) {
    throw new DashboardUpdateNotificationError(403, "dashboard access required");
  }
  return dashboard;
}

function subscriptionFromRow(
  dashboardId: string,
  dashboardName: string,
  email: string,
  row: { enabled?: boolean; created_at?: unknown; updated_at?: unknown } | undefined
): DashboardUpdateSubscriptionState {
  return {
    dashboardId,
    dashboardName,
    email,
    enabled: row?.enabled === true,
    available: true,
    createdAt: isoOrNull(row?.created_at),
    updatedAt: isoOrNull(row?.updated_at),
  };
}

async function directSubscriptionState(
  viewer: NotificationViewer,
  dashboardId: string
): Promise<DashboardUpdateSubscriptionState | null> {
  if (!hasDatabaseConfig()) return null;
  const dashboard = assertNotificationAccess(viewer, dashboardId);
  const normalizedEmail = normalizeEmail(viewer.email);
  try {
    const result = await getDbPool().query(
      `
        SELECT dashboard_id, email, enabled, created_at, updated_at
        FROM dashboard_update_subscriptions
        WHERE dashboard_id = $1 AND email = $2
        LIMIT 1
      `,
      [dashboard.id, normalizedEmail]
    );
    return subscriptionFromRow(dashboard.id, dashboard.name, normalizedEmail, result.rows[0]);
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

async function fetchBackendJson<T>(path: string, viewer: NotificationViewer, init: RequestInit = {}): Promise<T | null> {
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
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new DashboardUpdateNotificationError(response.status, body?.error || `dashboard update request failed with ${response.status}`);
  }
  return body;
}

export function dashboardUpdateNotificationStatus(error: unknown, fallback = 503): number {
  return error instanceof DashboardUpdateNotificationError ? error.status : fallback;
}

export async function getDashboardUpdateSubscriptionState(
  viewer: NotificationViewer,
  dashboardId: string
): Promise<DashboardUpdateSubscriptionState> {
  const dashboard = assertNotificationAccess(viewer, dashboardId);
  const fallback: DashboardUpdateSubscriptionState = {
    dashboardId: dashboard.id,
    dashboardName: dashboard.name,
    email: normalizeEmail(viewer.email),
    enabled: false,
    available: true,
    createdAt: null,
    updatedAt: null,
  };

  try {
    const backend = await fetchBackendJson<{ subscription: DashboardUpdateSubscriptionState }>(
      `/dashboard-updates/subscription?dashboard_id=${encodeURIComponent(dashboard.id)}`,
      viewer
    );
    if (backend?.subscription) return backend.subscription;

    return (await directSubscriptionState(viewer, dashboard.id)) || fallback;
  } catch (error) {
    if (error instanceof DashboardUpdateNotificationError && error.status === 403) throw error;
    console.warn("[dashboard-updates] subscription state unavailable", error);
    return { ...fallback, available: false };
  }
}

export async function setDashboardUpdateSubscriptionState(
  viewer: NotificationViewer,
  dashboardId: string,
  enabled: boolean
): Promise<DashboardUpdateSubscriptionState> {
  const dashboard = assertNotificationAccess(viewer, dashboardId);
  const normalizedEmail = normalizeEmail(viewer.email);
  const backend = await fetchBackendJson<{ subscription: DashboardUpdateSubscriptionState }>(
    "/dashboard-updates/subscription",
    viewer,
    {
      method: "POST",
      body: JSON.stringify({ dashboard_id: dashboard.id, enabled }),
    }
  );
  if (backend?.subscription) return backend.subscription;

  if (!hasDatabaseConfig()) {
    throw new DashboardUpdateNotificationError(503, "dashboard update notifications are not configured");
  }

  try {
    const result = await getDbPool().query(
      `
        INSERT INTO dashboard_update_subscriptions(dashboard_id, email, enabled)
        VALUES ($1, $2, $3)
        ON CONFLICT (dashboard_id, email)
        DO UPDATE SET enabled = EXCLUDED.enabled
        RETURNING dashboard_id, email, enabled, created_at, updated_at
      `,
      [dashboard.id, normalizedEmail, enabled]
    );
    return subscriptionFromRow(dashboard.id, dashboard.name, normalizedEmail, result.rows[0]);
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new DashboardUpdateNotificationError(503, "dashboard update notification schema has not been migrated");
    }
    throw error;
  }
}

export async function publishDashboardUpdate(
  viewer: NotificationViewer,
  payload: DashboardUpdatePublishPayload
): Promise<DashboardUpdatePublishResult> {
  const dashboard = findUpdateNotificationDashboard(normalizeDashboardId(payload.dashboardId));
  if (!dashboard) {
    throw new DashboardUpdateNotificationError(400, "dashboard does not support update notifications");
  }
  const backend = await fetchBackendJson<DashboardUpdatePublishResult>("/dashboard-updates/events", viewer, {
    method: "POST",
    body: JSON.stringify({
      dashboard_id: dashboard.id,
      title: payload.title,
      summary: payload.summary,
      url: payload.url,
      source: payload.source,
      source_ref: payload.sourceRef,
    }),
  });
  if (!backend) {
    throw new DashboardUpdateNotificationError(503, "dashboard update publisher requires the backend API");
  }
  return backend;
}
