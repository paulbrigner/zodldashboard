import {
  getArktourosHtmlPath,
  getPgpzRoadmapHtmlPath,
  getZodlRoadmapHtmlPath,
  readArktourosHtml,
  readPgpzRoadmapHtml,
  readZodlRoadmapHtml,
} from "@/lib/private-dashboard-content";
import {
  recordArktourosAccess,
  recordPgpzRoadmapAccess,
  recordZodlRoadmapAccess,
  type RoadmapAccessOutcome,
} from "@/lib/roadmap-access-events";
import {
  canAccessArktouros,
  canAccessPgpzRoadmap,
  canAccessRoadmap,
  type ViewerAccessLevel,
} from "@/lib/viewer-access";
import type { AuthenticatedViewer } from "@/lib/viewer-auth";

type HeaderReader = {
  get(name: string): string | null;
};

type DashboardAccessInput = {
  accessLevel: ViewerAccessLevel;
  email: string;
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
    visible: true,
    missingTitle: "Zodl Roadmap unavailable",
    missingHeading: "Zodl Roadmap content is not configured",
    missingBody: "The private HTML file was not found in the configured roadmap content path.",
    readHtml: readZodlRoadmapHtml,
    getHtmlPath: getZodlRoadmapHtmlPath,
    canAccess: (viewer) => canAccessRoadmap(viewer.accessLevel),
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
    visible: true,
    missingTitle: "PGPZ Roadmap unavailable",
    missingHeading: "PGPZ Roadmap content is not configured",
    missingBody: "The private HTML file was not found in the configured PGPZ roadmap content path.",
    readHtml: readPgpzRoadmapHtml,
    getHtmlPath: getPgpzRoadmapHtmlPath,
    canAccess: (viewer) => canAccessPgpzRoadmap(viewer.accessLevel),
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
    visible: true,
    missingTitle: "Arktouros unavailable",
    missingHeading: "Arktouros content is not configured",
    missingBody: "The private HTML file was not found in the configured Arktouros content path.",
    readHtml: readArktourosHtml,
    getHtmlPath: getArktourosHtmlPath,
    canAccess: (viewer) => canAccessArktouros(viewer.accessLevel, viewer.email),
    recordAccess: recordArktourosAccess,
  },
  {
    id: "x-monitor",
    kind: "app",
    name: "X Monitor",
    navLabel: "X Monitor",
    description:
      "Monitor the Zcash conversation on X with searchable captured posts, relevance filtering, trend summaries, and source-backed AI answers.",
    href: "/x-monitor",
    visible: true,
  },
  {
    id: "cipherpay-test",
    kind: "app",
    name: "CipherPay Test",
    navLabel: "CipherPay Test",
    description: "CipherPay admin config, webhook callback logging, and a minimal checkout simulator.",
    href: "/cipherpay-test",
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
    visible: false,
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

export function navigableDashboards(): DashboardCatalogItem[] {
  return visibleDashboards().filter((dashboard) => Boolean(dashboard.href));
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
  if (!dashboard.workspaceOnly) return true;
  if (dashboard.kind === "private-html") return dashboard.canAccess(viewer);
  return viewer.accessLevel === "workspace" || viewer.accessLevel === "local-bypass";
}
