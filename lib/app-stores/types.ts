export type StoreId = "apple" | "google";
export type PlatformId = "iOS" | "Android";

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "removed"
  | "developer_action_required";

export type ReadinessGate = "green" | "yellow" | "red";

export type ChecklistItemStatus = "done" | "needs_attention" | "blocked";

export type DeclarationStatus = "not_started" | "in_progress" | "completed" | "needs_update" | "overdue";

export type DeclarationDecision = "required" | "not_required" | "depends" | "unknown" | "blocked";

export type RegionScope = "all_regions" | "per_region";

export type FeatureAvailability = "allowed" | "disabled" | "limited" | "under_review";

export type CaseType = "rejection" | "warning" | "policy_inquiry" | "escalation" | "reinstatement";

export type CaseSeverity = "low" | "medium" | "high" | "critical";

export type CaseStatus = "open" | "awaiting_response" | "resolved";

export type EvidenceType =
  | "legal_memo"
  | "counsel_email"
  | "policy_analysis"
  | "licensing_determination"
  | "sanctions_control"
  | "architecture_note"
  | "console_screenshot"
  | "submission_ui_capture";

export type ConfidentialityTier = "internal" | "restricted" | "legal_privileged";

export type ReleaseTrain = {
  id: string;
  store: StoreId;
  platform: PlatformId;
  version: string;
  buildNumber: string;
  status: SubmissionStatus;
  targetDate: string;
  owner: string;
  blockers: string[];
};

export type ChecklistItem = {
  id: string;
  label: string;
  status: ChecklistItemStatus;
  note?: string;
};

export type SubmissionRun = {
  id: string;
  store: StoreId;
  platform: PlatformId;
  appVersion: string;
  buildNumber: string;
  track: string;
  submissionDate: string;
  status: SubmissionStatus;
  blockers: string[];
  ownerEngineering: string;
  approverPolicyLegal: string;
  consoleUrl: string;
  checklistSnapshotUrl: string;
  evidenceBundleUrl: string;
  releaseNotesUrl: string;
  whatChanged: string;
  declarationsTouched: string[];
  assetsUsed: string[];
  reviewerCaseId?: string;
  outcome: string;
  lessonsLearned: string;
  readinessGate: ReadinessGate;
  checklist: ChecklistItem[];
};

export type DeclarationCoverage = {
  id: string;
  store: StoreId;
  declarationType: string;
  scope: RegionScope;
  regionCode: string;
  regionLabel: string;
  status: DeclarationStatus;
  effectiveDate: string;
  updateByDate: string;
  requiresDocs: "yes" | "no" | "unknown";
  internalDetermination: DeclarationDecision;
  signOffBy?: string;
  signOffDate?: string;
  notes: string;
  answersSnapshot: string;
  rationale: string;
  sourceLinks: string[];
};

export type FeatureClaimMatrixRow = {
  featureId: string;
  featureName: string;
  description: string;
  uiSurfaces: string[];
  dataTouched: string[];
  dependencies: string[];
  providesCryptoFeatures: boolean;
  custodyModel: "non_custodial" | "custodial" | "hybrid";
  swapsMode: "none" | "on_chain" | "intent" | "dex_aggregation";
  feesModel: string;
  fiatOnOffRamp: boolean;
  stakingYield: boolean;
  kycCollection: boolean;
  geofencingSanctionsControls: string;
  financialAdviceAvoidanceLanguage: string;
  declarationLinks: string[];
  evidenceLinks: string[];
};

export type JurisdictionPosture = {
  featureId: string;
  regionCode: string;
  regionLabel: string;
  availability: FeatureAvailability;
  rationale: string;
};

export type ReviewerCase = {
  id: string;
  store: StoreId;
  caseType: CaseType;
  severity: CaseSeverity;
  status: CaseStatus;
  openedAt: string;
  lastActivityAt: string;
  owner: string;
  affectedVersions: string[];
  policyCitations: string[];
  attachments: string[];
  resolutionNotes: string;
  playbookTag: string;
};

export type CaseEvent = {
  id: string;
  caseId: string;
  timestamp: string;
  author: string;
  channel: string;
  message: string;
};

export type EvidenceItem = {
  id: string;
  title: string;
  evidenceType: EvidenceType;
  jurisdictions: string[];
  features: string[];
  stores: StoreId[];
  effectiveFrom: string;
  effectiveTo?: string;
  owner: string;
  approver: string;
  confidentiality: ConfidentialityTier;
  storageRef: string;
};

export type EvidenceBundle = {
  id: string;
  name: string;
  submissionId: string;
  createdAt: string;
  createdBy: string;
  evidenceItemIds: string[];
  notes: string;
};

export type FeatureChange = {
  id: string;
  releaseVersion: string;
  featureName: string;
  summary: string;
  reviewed: boolean;
  riskFlags: string[];
};

export type DashboardIntegrationStatus = {
  githubReleases: "planned" | "active";
  slackAlerts: "planned" | "active";
  consoleIngestion: "planned" | "manual_only" | "partial";
};

export type AppStoresDataset = {
  generatedAt: string;
  releaseTrains: ReleaseTrain[];
  submissions: SubmissionRun[];
  declarations: DeclarationCoverage[];
  featureMatrix: FeatureClaimMatrixRow[];
  jurisdictionPosture: JurisdictionPosture[];
  reviewerCases: ReviewerCase[];
  caseEvents: CaseEvent[];
  evidenceItems: EvidenceItem[];
  evidenceBundles: EvidenceBundle[];
  featureChanges: FeatureChange[];
  integrationStatus: DashboardIntegrationStatus;
};
