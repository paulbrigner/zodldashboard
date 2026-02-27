import type {
  CombinedActivityItem,
  Jurisdiction,
  RegulatoryRiskDataBundle,
  SignalEvent,
  TaskBacklogItem,
  TaskStatus,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseIsoDate(dateText: string): Date | null {
  if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return null;
  }

  const date = new Date(`${dateText}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIsoDate(dateText: string): string {
  const date = parseIsoDate(dateText);
  if (!date) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function daysUntilIsoDate(dateText: string, now = new Date()): number | null {
  const target = parseIsoDate(dateText);
  if (!target) {
    return null;
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetUtc - todayUtc) / MS_PER_DAY);
}

export function computeTierCounts(bundle: RegulatoryRiskDataBundle): Record<string, number> {
  const counts: Record<string, number> = {};

  Object.keys(bundle.tiers).forEach((tierCode) => {
    counts[tierCode] = 0;
  });

  bundle.jurisdictions.forEach((jurisdiction) => {
    counts[jurisdiction.tier] = (counts[jurisdiction.tier] || 0) + 1;
  });

  return counts;
}

export function getJurisdictionsMissingPrimarySources(jurisdictions: Jurisdiction[]): Jurisdiction[] {
  return jurisdictions.filter((jurisdiction) => jurisdiction.primary_sources.length === 0);
}

export function computeVerificationStats(jurisdictions: Jurisdiction[]): {
  latestVerifiedDate: string | null;
  latestVerifiedCount: number;
  nextVerificationDueDate: string | null;
} {
  if (jurisdictions.length === 0) {
    return {
      latestVerifiedDate: null,
      latestVerifiedCount: 0,
      nextVerificationDueDate: null,
    };
  }

  let latestVerifiedDate: string | null = null;
  let nextVerificationDueDate: string | null = null;

  jurisdictions.forEach((jurisdiction) => {
    if (jurisdiction.last_verified_on) {
      if (!latestVerifiedDate || jurisdiction.last_verified_on > latestVerifiedDate) {
        latestVerifiedDate = jurisdiction.last_verified_on;
      }
    }

    if (jurisdiction.next_verification_due_on) {
      if (!nextVerificationDueDate || jurisdiction.next_verification_due_on < nextVerificationDueDate) {
        nextVerificationDueDate = jurisdiction.next_verification_due_on;
      }
    }
  });

  const latestVerifiedCount = latestVerifiedDate
    ? jurisdictions.filter((jurisdiction) => jurisdiction.last_verified_on === latestVerifiedDate).length
    : 0;

  return {
    latestVerifiedDate,
    latestVerifiedCount,
    nextVerificationDueDate,
  };
}

export function buildCombinedActivity(
  bundle: RegulatoryRiskDataBundle,
  options?: {
    signalLimit?: number;
  }
): CombinedActivityItem[] {
  const signalLimit = options?.signalLimit;
  const selectedSignals =
    typeof signalLimit === "number" && signalLimit >= 0
      ? [...bundle.signals]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, signalLimit)
      : [...bundle.signals];

  const signalItems: CombinedActivityItem[] = selectedSignals.map((signal) => ({
    kind: "signal",
    date: signal.date,
    summary: buildSignalSummary(signal, bundle),
    sourceRefs: [],
    signal,
  }));

  const changeItems: CombinedActivityItem[] = bundle.change_log.map((entry) => ({
    kind: "change",
    date: entry.date,
    summary: entry.summary,
    sourceRefs: entry.source_refs,
  }));

  return [...changeItems, ...signalItems].sort((a, b) => b.date.localeCompare(a.date));
}

function buildSignalSummary(signal: SignalEvent, bundle: RegulatoryRiskDataBundle): string {
  const jurisdictionName = signal.jurisdiction_id
    ? bundle.jurisdictions.find((jurisdiction) => jurisdiction.id === signal.jurisdiction_id)?.name
    : null;

  const summary =
    signal.details && typeof signal.details.summary === "string" ? signal.details.summary : "Signal recorded";

  return jurisdictionName ? `${signal.type} (${jurisdictionName}): ${summary}` : `${signal.type}: ${summary}`;
}

export function computeTaskCounts(tasks: TaskBacklogItem[]): Record<TaskStatus, number> {
  return tasks.reduce<Record<TaskStatus, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {} as Record<TaskStatus, number>);
}
