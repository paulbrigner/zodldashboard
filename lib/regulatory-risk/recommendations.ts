import { daysUntilIsoDate, getJurisdictionsMissingPrimarySources } from "./insights";
import type {
  ComputedRecommendation,
  RecommendationPriority,
  RecommendationRuleWhen,
  RegulatoryRiskDataBundle,
  SuggestedTask,
} from "./types";

const PRIORITY_WEIGHT: Record<RecommendationPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

type EvaluatedRecommendation = ComputedRecommendation & {
  order: number;
};

function matchesRule(when: RecommendationRuleWhen, bundle: RegulatoryRiskDataBundle): boolean {
  if (when.any_feature_category) {
    const hasCategory = bundle.feature_catalog.some((feature) => feature.category === when.any_feature_category);
    if (!hasCategory) {
      return false;
    }
  }

  if (when.any_jurisdiction_tier) {
    const hasTier = bundle.jurisdictions.some((jurisdiction) => jurisdiction.tier === when.any_jurisdiction_tier);
    if (!hasTier) {
      return false;
    }
  }

  if (typeof when.policy_review_due_in_days_lte === "number") {
    const daysUntilReview = daysUntilIsoDate(bundle.review_schedule.next_review_on);
    if (daysUntilReview === null || daysUntilReview > when.policy_review_due_in_days_lte) {
      return false;
    }
  }

  if (when.signal_type) {
    const hasSignalType = bundle.signals.some((signal) => signal.type === when.signal_type);
    if (!hasSignalType) {
      return false;
    }
  }

  if (when.any_jurisdiction_missing_primary_sources) {
    const missingSourcesCount = getJurisdictionsMissingPrimarySources(bundle.jurisdictions).length;
    if (missingSourcesCount === 0) {
      return false;
    }
  }

  return true;
}

function createSuggestedTaskIndex(bundle: RegulatoryRiskDataBundle): Map<string, SuggestedTask> {
  const index = new Map<string, SuggestedTask>();

  bundle.task_backlog.forEach((task) => {
    index.set(task.id, {
      id: task.id,
      title: task.title,
      owner_role: task.owner_role,
      status: task.status,
      source: "task_backlog",
    });
  });

  bundle.internal_processes.forEach((process) => {
    if (!index.has(process.id)) {
      index.set(process.id, {
        id: process.id,
        title: process.name,
        owner_role: process.owner_role,
        status: process.status,
        source: "internal_processes",
      });
    }
  });

  return index;
}

export function computeRecommendations(bundle: RegulatoryRiskDataBundle): ComputedRecommendation[] {
  const suggestedTaskIndex = createSuggestedTaskIndex(bundle);

  const evaluated = bundle.recommendation_rules
    .map<EvaluatedRecommendation | null>((rule, order) => {
      if (!matchesRule(rule.when, bundle)) {
        return null;
      }

      const suggestedTasks = rule.then.suggested_tasks
        .map((taskId) => suggestedTaskIndex.get(taskId))
        .filter((task): task is SuggestedTask => Boolean(task));

      const unresolvedTaskIds = rule.then.suggested_tasks.filter((taskId) => !suggestedTaskIndex.has(taskId));

      return {
        id: rule.id,
        title: rule.title,
        priority: rule.priority,
        rationale: rule.then.recommendation,
        suggestedTasks,
        unresolvedTaskIds,
        order,
      };
    })
    .filter((recommendation): recommendation is EvaluatedRecommendation => Boolean(recommendation));

  evaluated.sort((a, b) => {
    const priorityDelta = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return a.order - b.order;
  });

  return evaluated.map(({ order: _order, ...recommendation }) => recommendation);
}

export function getPriorityLabel(priority: RecommendationPriority): string {
  if (priority === "high") {
    return "High";
  }
  if (priority === "medium") {
    return "Medium";
  }
  return "Low";
}
