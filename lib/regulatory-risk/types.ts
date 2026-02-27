export type TierCode = "RED" | "AMBER" | "GREEN" | string;

export type TierDefinition = {
  label: string;
  definition: string;
  default_team_guidance: string[];
};

export type Jurisdiction = {
  id: string;
  name: string;
  region: string;
  tier: TierCode;
  scope: string[];
  risk_summary: string;
  team_guidance: string[];
  confidence: number;
  source_refs: string[];
  primary_sources: string[];
  last_verified_on: string;
  next_verification_due_on: string;
};

export type FeatureCategory = "WALLET" | "SERVICE" | "GTM" | string;

export type FeatureCatalogItem = {
  id: string;
  name: string;
  category: FeatureCategory;
  regulatory_triggers: string[];
  notes: string;
  recommended_controls: string[];
};

export type GuardrailStatus = "required" | "recommended" | string;

export type Guardrail = {
  id: string;
  title: string;
  type: string;
  status: GuardrailStatus;
  detail: string;
  source_refs: string[];
};

export type InternalProcess = {
  id: string;
  name: string;
  cadence: string;
  owner_role: string;
  output: string;
  status: string;
  source_refs: string[];
};

export type OperatingPolicyMode = {
  id: string;
  label: string;
  applies_to: TierCode[];
  description: string;
};

export type OperatingPolicyPermissionRow = {
  scenario: string;
  RED: string;
  AMBER: string;
  GREEN: string;
};

export type OperatingPolicy = {
  modes: OperatingPolicyMode[];
  permission_matrix: OperatingPolicyPermissionRow[];
  implementation_controls: string[];
  source_refs: string[];
};

export type SignalEvent = {
  id: string;
  date: string;
  type: string;
  jurisdiction_id?: string;
  details?: Record<string, unknown>;
};

export type RecommendationRuleWhen = {
  any_feature_category?: FeatureCategory;
  any_jurisdiction_tier?: TierCode;
  policy_review_due_in_days_lte?: number;
  signal_type?: string;
  any_jurisdiction_missing_primary_sources?: boolean;
};

export type RecommendationRuleThen = {
  recommendation: string;
  suggested_tasks: string[];
};

export type RecommendationRule = {
  id: string;
  title: string;
  priority: RecommendationPriority;
  when: RecommendationRuleWhen;
  then: RecommendationRuleThen;
};

export type TaskBacklogItem = {
  id: string;
  title: string;
  owner_role: string;
  status: TaskStatus;
};

export type TaskStatus = "planned" | "in_progress" | "done" | string;

export type ChangeLogEntry = {
  date: string;
  summary: string;
  source_refs: string[];
};

export type ReviewSchedule = {
  last_reviewed_on: string;
  next_review_on: string;
  owner_role: string;
};

export type DataMeta = {
  title: string;
  version: string;
  generated_on: string;
  source_deck: string;
  notes: string[];
};

export type RegulatoryRiskDataBundle = {
  meta: DataMeta;
  tiers: Record<string, TierDefinition>;
  jurisdictions: Jurisdiction[];
  feature_catalog: FeatureCatalogItem[];
  guardrails: Guardrail[];
  internal_processes: InternalProcess[];
  operating_policy: OperatingPolicy;
  signals: SignalEvent[];
  recommendation_rules: RecommendationRule[];
  task_backlog: TaskBacklogItem[];
  change_log: ChangeLogEntry[];
  review_schedule: ReviewSchedule;
};

export type RecommendationPriority = "high" | "medium" | "low";

export type SuggestedTask = {
  id: string;
  title: string;
  owner_role: string;
  status: string;
  source: "task_backlog" | "internal_processes";
};

export type ComputedRecommendation = {
  id: string;
  title: string;
  priority: RecommendationPriority;
  rationale: string;
  suggestedTasks: SuggestedTask[];
  unresolvedTaskIds: string[];
};

export type RecommendationContext = {
  daysUntilNextReview: number | null;
  missingPrimarySourceCount: number;
  signalTypes: Set<string>;
  featureCategories: Set<string>;
  jurisdictionTiers: Set<string>;
};

export type CombinedActivityItem = {
  kind: "change" | "signal";
  date: string;
  summary: string;
  sourceRefs: string[];
  signal?: SignalEvent;
};
