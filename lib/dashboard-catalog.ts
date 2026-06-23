import {
  getArktourosHtmlPath,
  getPgpzRoadmapHtmlPath,
  getPlacehodlrHtmlPath,
  getZodlSummitHtmlPath,
  getZodlRoadmapHtmlPath,
  readArktourosHtml,
  readPgpzRoadmapHtml,
  readPlacehodlrHtml,
  readZodlSummitHtml,
  readZodlRoadmapHtml,
} from "@/lib/private-dashboard-content";
import {
  recordArktourosAccess,
  recordPgpzRoadmapAccess,
  recordPlacehodlrAccess,
  recordZodlSummitAccess,
  recordZodlRoadmapAccess,
  type RoadmapAccessOutcome,
} from "@/lib/roadmap-access-events";
import {
  ACCESS_ADMIN_PERMISSION,
  canReadDashboard,
  dashboardReadPermission,
  hasAccessPermission,
  type EffectiveAccess,
} from "@/lib/access-control";
import { type ViewerAccessLevel } from "@/lib/viewer-access";
import type { AuthenticatedViewer } from "@/lib/viewer-auth";

type HeaderReader = {
  get(name: string): string | null;
};

type DashboardAccessInput = {
  accessLevel: ViewerAccessLevel;
  email: string;
  permissions?: EffectiveAccess["permissions"];
};

export type DashboardKind = "app" | "private-html" | "placeholder";

export type DashboardAccessEventInput = {
  viewer: AuthenticatedViewer;
  outcome: RoadmapAccessOutcome;
  statusCode: number;
  headers: HeaderReader;
};

type DashboardBase = {
  id: string;
  name: string;
  navLabel: string;
  description: string;
  href?: string;
  prefetch?: boolean;
  workspaceOnly?: boolean;
  requiredPermission?: string;
  supportsUpdateNotifications?: boolean;
  visible: boolean;
};

export type AppDashboard = DashboardBase & {
  kind: "app";
};

export type PlaceholderDashboard = DashboardBase & {
  kind: "placeholder";
};

export type PrivateHtmlDashboard = DashboardBase & {
  kind: "private-html";
  contentHref: string;
  missingTitle: string;
  missingHeading: string;
  missingBody: string;
  readHtml: () => Promise<string | null>;
  getHtmlPath: () => string;
  canAccess: (viewer: DashboardAccessInput) => boolean;
  recordAccess: (input: DashboardAccessEventInput) => Promise<void>;
};

export type DashboardCatalogItem = AppDashboard | PrivateHtmlDashboard | PlaceholderDashboard;
export type DashboardUpdateNotificationItem = Extract<DashboardCatalogItem, { kind: "app" | "private-html" }>;

export const dashboardCatalog: DashboardCatalogItem[] = [
  {
    id: "zodl-roadmap",
    kind: "private-html",
    name: "Zodl Roadmap",
    navLabel: "Zodl Roadmap",
    description:
      "Hold Private. Spend everywhere. Three tracks, seven stones, and the strategic roadmap for ZODL's private-money product direction.",
    href: "/zodl-roadmap",
    contentHref: "/zodl-roadmap/content",
    prefetch: false,
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("zodl-roadmap"),
    supportsUpdateNotifications: true,
    visible: true,
    missingTitle: "Zodl Roadmap unavailable",
    missingHeading: "Zodl Roadmap content is not configured",
    missingBody: "The private HTML file was not found in the configured roadmap content path.",
    readHtml: readZodlRoadmapHtml,
    getHtmlPath: getZodlRoadmapHtmlPath,
    canAccess: (viewer) => canReadDashboard({ accessLevel: viewer.accessLevel, permissions: viewer.permissions || [] }, "zodl-roadmap"),
    recordAccess: recordZodlRoadmapAccess,
  },
  {
    id: "pgpz-roadmap",
    kind: "private-html",
    name: "Accrediv Updates & PGPZ Status",
    navLabel: "PGPZ Roadmap",
    description:
      "Policy updates from Accrediv, plus status tracking for the formation and planned activities of the Pretty Good Policy for Zcash Coalition.",
    href: "/pgpz-roadmap",
    contentHref: "/pgpz-roadmap/content",
    prefetch: false,
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("pgpz-roadmap"),
    supportsUpdateNotifications: true,
    visible: true,
    missingTitle: "PGPZ Roadmap unavailable",
    missingHeading: "PGPZ Roadmap content is not configured",
    missingBody: "The private HTML file was not found in the configured PGPZ roadmap content path.",
    readHtml: readPgpzRoadmapHtml,
    getHtmlPath: getPgpzRoadmapHtmlPath,
    canAccess: (viewer) => canReadDashboard({ accessLevel: viewer.accessLevel, permissions: viewer.permissions || [] }, "pgpz-roadmap"),
    recordAccess: recordPgpzRoadmapAccess,
  },
  {
    id: "arktouros",
    kind: "private-html",
    name: "Arktouros & U.S. Regulatory",
    navLabel: "Arktouros",
    description:
      "Private workspace for Arktouros project context, U.S. regulatory focus, coordination notes, and current priorities.",
    href: "/arktouros",
    contentHref: "/arktouros/content",
    prefetch: false,
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("arktouros"),
    supportsUpdateNotifications: true,
    visible: true,
    missingTitle: "Arktouros unavailable",
    missingHeading: "Arktouros content is not configured",
    missingBody: "The private HTML file was not found in the configured Arktouros content path.",
    readHtml: readArktourosHtml,
    getHtmlPath: getArktourosHtmlPath,
    canAccess: (viewer) => canReadDashboard({ accessLevel: viewer.accessLevel, permissions: viewer.permissions || [] }, "arktouros"),
    recordAccess: recordArktourosAccess,
  },
  {
    id: "placehodlr",
    kind: "private-html",
    name: "Placehodlr & EU Regulatory.",
    navLabel: "Placehodlr",
    description:
      "Private workspace for Placehodlr project context, EU regulatory coordination, current priorities, source files, and the dashboard change trail.",
    href: "/placehodlr",
    contentHref: "/placehodlr/content",
    prefetch: false,
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("placehodlr"),
    supportsUpdateNotifications: true,
    visible: true,
    missingTitle: "Placehodlr unavailable",
    missingHeading: "Placehodlr content is not configured",
    missingBody: "The private HTML file was not found in the configured Placehodlr content path.",
    readHtml: readPlacehodlrHtml,
    getHtmlPath: getPlacehodlrHtmlPath,
    canAccess: (viewer) => canReadDashboard({ accessLevel: viewer.accessLevel, permissions: viewer.permissions || [] }, "placehodlr"),
    recordAccess: recordPlacehodlrAccess,
  },
  {
    id: "2026-zodl-summit",
    kind: "private-html",
    name: "Zodl Summit",
    navLabel: "Zodl Summit",
    description:
      "Private working dashboard for the 2026 Zodl Summit: planning context, logistics, agenda tracks, stakeholder notes, and coordination status.",
    href: "/2026-zodl-summit",
    contentHref: "/2026-zodl-summit/content",
    prefetch: false,
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("2026-zodl-summit"),
    supportsUpdateNotifications: true,
    visible: true,
    missingTitle: "Zodl Summit unavailable",
    missingHeading: "Zodl Summit content is not configured",
    missingBody: "The private HTML file was not found in the configured 2026 Zodl Summit content path.",
    readHtml: readZodlSummitHtml,
    getHtmlPath: getZodlSummitHtmlPath,
    canAccess: (viewer) => canReadDashboard({ accessLevel: viewer.accessLevel, permissions: viewer.permissions || [] }, "2026-zodl-summit"),
    recordAccess: recordZodlSummitAccess,
  },
  {
    id: "x-monitor",
    kind: "app",
    name: "X Monitor",
    navLabel: "X Monitor",
    description:
      "Monitor the Zcash conversation on X with searchable captured posts, relevance filtering, trend summaries, and source-backed AI answers.",
    href: "/x-monitor",
    requiredPermission: dashboardReadPermission("x-monitor"),
    visible: true,
  },
  {
    id: "cipherpay-test",
    kind: "app",
    name: "CipherPay Test",
    navLabel: "CipherPay Test",
    description: "CipherPay admin config, webhook callback logging, and a minimal checkout simulator.",
    href: "/cipherpay-test",
    requiredPermission: dashboardReadPermission("cipherpay-test"),
    supportsUpdateNotifications: true,
    visible: false,
  },
  {
    id: "regulatory-risk",
    kind: "app",
    name: "Regulatory Risk by Geography",
    navLabel: "Regulatory Risk",
    description: "Tiered jurisdiction risk, recommendations, policy posture, and activity feed.",
    href: "/regulatory-risk",
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("regulatory-risk"),
    supportsUpdateNotifications: true,
    visible: false,
  },
  {
    id: "app-store-compliance",
    kind: "app",
    name: "App Store Dashboard",
    navLabel: "App Stores",
    description: "Compliance posture, declarations, submissions, reviewer cases, and evidence bundles.",
    href: "/app-stores",
    workspaceOnly: true,
    requiredPermission: dashboardReadPermission("app-store-compliance"),
    supportsUpdateNotifications: true,
    visible: false,
  },
  {
    id: "admin-access",
    kind: "app",
    name: "Access Admin",
    navLabel: "Access Admin",
    description: "Manage users, groups, roles, dashboard privileges, invitations, and access audit logs.",
    href: "/admin/access",
    requiredPermission: ACCESS_ADMIN_PERMISSION,
    visible: true,
  },
  {
    id: "placeholder",
    kind: "placeholder",
    name: "Dashboard Placeholder",
    navLabel: "Placeholder",
    description: "Reserved for a future dashboard.",
    visible: true,
  },
];

export function visibleDashboards(): DashboardCatalogItem[] {
  return dashboardCatalog.filter((dashboard) => dashboard.visible);
}

export function visibleDashboardsForViewer(viewer: DashboardAccessInput): DashboardCatalogItem[] {
  return visibleDashboards()
    .map((dashboard, index) => ({
      dashboard,
      index,
      hasOpenAccess: Boolean(dashboard.href) && canAccessDashboard(dashboard, viewer),
    }))
    .sort((a, b) => {
      if (a.hasOpenAccess !== b.hasOpenAccess) {
        return a.hasOpenAccess ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((item) => item.dashboard);
}

export function navigableDashboards(): DashboardCatalogItem[] {
  return visibleDashboards().filter((dashboard) => Boolean(dashboard.href));
}

export function updateNotificationDashboards(): DashboardUpdateNotificationItem[] {
  return visibleDashboards().filter(
    (dashboard): dashboard is DashboardUpdateNotificationItem =>
      dashboard.kind !== "placeholder" && Boolean(dashboard.href) && dashboard.supportsUpdateNotifications === true
  );
}

export function findUpdateNotificationDashboard(id: string): DashboardUpdateNotificationItem | null {
  return updateNotificationDashboards().find((dashboard) => dashboard.id === id) || null;
}

export function privateHtmlDashboards(): PrivateHtmlDashboard[] {
  return dashboardCatalog.filter((dashboard): dashboard is PrivateHtmlDashboard => dashboard.kind === "private-html");
}

export function findPrivateHtmlDashboard(id: string): PrivateHtmlDashboard {
  const dashboard = privateHtmlDashboards().find((item) => item.id === id);
  if (!dashboard) {
    throw new Error(`Unknown private dashboard: ${id}`);
  }

  return dashboard;
}

export function canAccessDashboard(dashboard: DashboardCatalogItem, viewer: DashboardAccessInput): boolean {
  if (dashboard.requiredPermission?.startsWith("dashboard:")) {
    return canReadDashboard({ accessLevel: viewer.accessLevel, permissions: viewer.permissions || [] }, dashboard.id);
  }
  if (dashboard.requiredPermission) {
    return hasAccessPermission({ permissions: viewer.permissions || [] }, dashboard.requiredPermission);
  }
  if (!dashboard.workspaceOnly) return true;
  if (dashboard.kind === "private-html") return dashboard.canAccess(viewer);
  return viewer.accessLevel === "local-bypass";
}
