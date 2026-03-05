import type {
  AppStoresDataset,
  CaseEvent,
  DeclarationCoverage,
  FeatureClaimMatrixRow,
  ReviewerCase,
  SubmissionRun,
} from "@/lib/app-stores/types";

export type OverviewKpis = {
  releaseBlockers: number;
  deadlines30d: number;
  deadlines60d: number;
  deadlines90d: number;
  nextDeadlineDate: string | null;
  openReviewerThreads: number;
  highRiskJurisdictionsAffected: number;
  unreviewedFeatureChanges: number;
};

export type OverviewAlert = {
  id: string;
  severity: "critical" | "high" | "medium";
  text: string;
};

export type DeclarationStatusSummaryRow = {
  store: string;
  declarationType: string;
  completed: number;
  inProgress: number;
  needsAttention: number;
  overdue: number;
  nextDeadline: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(dateIso: string, now = new Date()): number {
  const target = new Date(dateIso);
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
}

export function formatDate(dateIso: string): string {
  const date = new Date(dateIso);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(dateIso: string): string {
  const date = new Date(dateIso);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function findNextDeadline(declarations: DeclarationCoverage[]): string | null {
  const sorted = declarations
    .map((row) => row.updateByDate)
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return sorted[0] ?? null;
}

export function computeOverviewKpis(dataset: AppStoresDataset): OverviewKpis {
  const releaseBlockers = dataset.releaseTrains.filter((train) => train.blockers.length > 0).length;

  const deadlines = dataset.declarations.map((row) => daysUntil(row.updateByDate));
  const deadlines30d = deadlines.filter((days) => days >= 0 && days <= 30).length;
  const deadlines60d = deadlines.filter((days) => days >= 0 && days <= 60).length;
  const deadlines90d = deadlines.filter((days) => days >= 0 && days <= 90).length;

  const openReviewerThreads = dataset.reviewerCases.filter((item) => item.status !== "resolved").length;

  const highRiskJurisdictionsAffected = new Set(
    dataset.declarations
      .filter(
        (row) =>
          ["required", "depends", "blocked"].includes(row.internalDetermination) &&
          ["overdue", "needs_update", "in_progress"].includes(row.status)
      )
      .map((row) => row.regionCode)
  ).size;

  const unreviewedFeatureChanges = dataset.featureChanges.filter((item) => !item.reviewed).length;

  return {
    releaseBlockers,
    deadlines30d,
    deadlines60d,
    deadlines90d,
    nextDeadlineDate: findNextDeadline(dataset.declarations),
    openReviewerThreads,
    highRiskJurisdictionsAffected,
    unreviewedFeatureChanges,
  };
}

export function buildCriticalAlerts(dataset: AppStoresDataset): OverviewAlert[] {
  const alerts: OverviewAlert[] = [];

  const overdueDeclarations = dataset.declarations.filter((row) => row.status === "overdue");
  for (const row of overdueDeclarations) {
    alerts.push({
      id: `overdue-${row.id}`,
      severity: "critical",
      text: `${row.store === "google" ? "Google Play" : "Apple"} declaration overdue for ${row.regionLabel}: ${
        row.declarationType
      } (due ${formatDate(row.updateByDate)}).`,
    });
  }

  const blockedSubmissions = dataset.submissions.filter((row) => row.status === "developer_action_required");
  for (const row of blockedSubmissions) {
    alerts.push({
      id: `submission-${row.id}`,
      severity: "high",
      text: `${row.store === "google" ? "Google Play" : "Apple"} ${row.platform} submission ${row.appVersion} (${row.buildNumber}) requires developer action.`,
    });
  }

  const unresolvedCases = dataset.reviewerCases.filter((row) => row.status !== "resolved" && row.severity !== "low");
  for (const row of unresolvedCases) {
    alerts.push({
      id: `case-${row.id}`,
      severity: row.severity === "critical" ? "critical" : "medium",
      text: `Open ${row.store === "google" ? "Google" : "Apple"} reviewer thread (${row.playbookTag}) with status ${row.status.replace("_", " ")}.`,
    });
  }

  const unreviewedFeatureChanges = dataset.featureChanges.filter((item) => !item.reviewed);
  for (const item of unreviewedFeatureChanges) {
    alerts.push({
      id: `feature-change-${item.id}`,
      severity: "medium",
      text: `Feature change pending compliance review: ${item.featureName} in release ${item.releaseVersion}.`,
    });
  }

  return alerts.slice(0, 8);
}

export function buildDeclarationStatusSummary(dataset: AppStoresDataset): DeclarationStatusSummaryRow[] {
  const grouped = new Map<string, DeclarationCoverage[]>();

  for (const declaration of dataset.declarations) {
    const key = `${declaration.store}::${declaration.declarationType}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(declaration);
    } else {
      grouped.set(key, [declaration]);
    }
  }

  return Array.from(grouped.entries()).map(([key, rows]) => {
    const [store, declarationType] = key.split("::");
    const completed = rows.filter((row) => row.status === "completed").length;
    const inProgress = rows.filter((row) => row.status === "in_progress").length;
    const needsAttention = rows.filter((row) => row.status === "needs_update" || row.status === "not_started").length;
    const overdue = rows.filter((row) => row.status === "overdue").length;
    const nextDeadline = rows
      .map((row) => row.updateByDate)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

    return {
      store,
      declarationType,
      completed,
      inProgress,
      needsAttention,
      overdue,
      nextDeadline,
    };
  });
}

export function sortSubmissionsNewestFirst(submissions: SubmissionRun[]): SubmissionRun[] {
  return [...submissions].sort(
    (a, b) => new Date(b.submissionDate).getTime() - new Date(a.submissionDate).getTime()
  );
}

export function sortCasesNewestFirst(cases: ReviewerCase[]): ReviewerCase[] {
  return [...cases].sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
}

export function getSubmissionById(dataset: AppStoresDataset, submissionId: string | null): SubmissionRun | null {
  if (!submissionId) return null;
  return dataset.submissions.find((row) => row.id === submissionId) ?? null;
}

export function getCaseById(dataset: AppStoresDataset, caseId: string | null): ReviewerCase | null {
  if (!caseId) return null;
  return dataset.reviewerCases.find((row) => row.id === caseId) ?? null;
}

export function getEventsForCase(dataset: AppStoresDataset, caseId: string): CaseEvent[] {
  return dataset.caseEvents
    .filter((event) => event.caseId === caseId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function getEvidenceForSubmission(dataset: AppStoresDataset, submissionId: string) {
  const bundle = dataset.evidenceBundles.find((item) => item.submissionId === submissionId);
  if (!bundle) {
    return { bundle: null, items: [] };
  }

  const items = bundle.evidenceItemIds
    .map((id) => dataset.evidenceItems.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return { bundle, items };
}

export function buildStatementPack(featureRows: FeatureClaimMatrixRow[]): string[] {
  return featureRows.map((feature) => {
    const custody = feature.custodyModel === "non_custodial" ? "user-controlled non-custodial" : feature.custodyModel;
    const swaps = feature.swapsMode === "none" ? "No swap functionality." : `Swaps mode: ${feature.swapsMode}.`;

    return `${feature.featureName}: ${feature.description} Custody model: ${custody}. ${swaps} ${feature.financialAdviceAvoidanceLanguage}`;
  });
}
