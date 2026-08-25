export type RouterMode = "SHADOW" | "EXACT_CANARY";

export type RouteMetricSignature = Readonly<{
  routeVersionId: string;
  modelVersionId: string;
  inputMode: string;
  resolution: string;
  durationBucket: string;
  audioMode: string;
  referenceMode: string;
  adapterVersion: string;
  retryPolicyVersionId: string;
}>;

export type AttemptMetric = Readonly<{
  attemptNumber: number;
  reachProbabilityPpm: number;
  expectedCostMicrousd: string;
  usableSuccessProbabilityPpm: number;
}>;

export type ProfitRouteCandidate = Readonly<{
  routeVersionId: string;
  familyVersionId: string;
  providerId: string;
  providerAccountId: string;
  lifecycle: "PUBLISHED" | "SUSPENDED" | "RETIRED";
  expiresAt: string;
  capabilityMatches: boolean;
  exactEquivalence: Readonly<{
    required: boolean;
    approved: boolean;
    groupId: string | null;
  }>;
  cost: Readonly<{
    versionId: string;
    status: "FRESH" | "PROMOTIONAL" | "STALE" | "EXPIRED" | "UNKNOWN";
    validUntil: string;
  }>;
  credential: Readonly<{
    status: "ACTIVE" | "INVALID" | "REVOKED";
    expiresAt: string | null;
  }>;
  treasury: Readonly<{
    shadowAvailableAtomic: string;
    maximumExposureAtomic: string;
  }>;
  circuitClosed: boolean;
  capacityAvailable: boolean;
  privacyCompatible: boolean;
  actualCostExtractor: string | null;
  margin: Readonly<{
    projectedMarginBps: number;
    hardFloorMarginBps: number;
  }>;
  pinnedByQuote: boolean;
  metricsObservedAt: string;
  metricSignature: RouteMetricSignature;
  attempts: readonly AttemptMetric[];
}>;

export type RouterPolicyVersion = Readonly<{
  id: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  mode: RouterMode;
  allowStaleCost: boolean;
  maximumMetricAgeSeconds: number;
  publishedAt: string;
}>;

export type RouteHardGateCode =
  | "ROUTE_NOT_PUBLISHED"
  | "ROUTE_EXPIRED"
  | "CAPABILITY_MISMATCH"
  | "EXACT_EQUIVALENCE_REQUIRED"
  | "COST_VERSION_NOT_USABLE"
  | "CREDENTIAL_NOT_ACTIVE"
  | "SHADOW_BALANCE_INSUFFICIENT"
  | "CIRCUIT_OPEN"
  | "CAPACITY_UNAVAILABLE"
  | "PRIVACY_POLICY_MISMATCH"
  | "ACTUAL_COST_EXTRACTOR_MISSING"
  | "MARGIN_FLOOR_BREACH"
  | "METRICS_NOT_FRESH"
  | "ROUTE_NOT_PINNED_BY_QUOTE";

export type ExpectedCostPerUsableSuccess = Readonly<{
  expectedPolicyCost: Readonly<{ numeratorMicrousdPpm: string; denominatorPpm: string }>;
  usableSuccessProbability: Readonly<{ numerator: string; denominator: string }>;
  expectedCostPerUsableSuccess: Readonly<{
    numeratorMicrousd: string;
    denominator: string;
    ceilingMicrousd: string;
  }>;
}>;

export type CandidateFoundationEvaluation = Readonly<{
  decisionId: string;
  policyVersionId: string;
  mode: RouterMode;
  routeVersionId: string;
  evaluatedAt: string;
  eligible: boolean;
  rejectionReasons: readonly RouteHardGateCode[];
  metricSignature: RouteMetricSignature;
  economics: ExpectedCostPerUsableSuccess | null;
}>;

export class ProfitRouterError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ROUTER_POLICY"
      | "INVALID_ROUTE_CANDIDATE"
      | "INVALID_ATTEMPT_METRICS"
      | "INVALID_SCORE_POLICY"
      | "INVALID_SCORE_CANDIDATES"
      | "NO_ELIGIBLE_ROUTE"
      | "INVALID_METRIC_POLICY"
      | "INVALID_ROUTE_OUTCOME"
      | "ROUTE_OUTCOME_CONFLICT"
      | "SHADOW_DECISION_CONFLICT"
      | "SHADOW_DECISION_NOT_FOUND"
      | "SHADOW_REPLAY_MISMATCH"
      | "INVALID_CANARY_POLICY"
      | "INVALID_CANARY_TRANSITION"
      | "CANARY_APPROVAL_REQUIRED"
      | "CANARY_GATE_FAILED"
      | "INVALID_GATE_EVIDENCE",
    message: string,
  ) {
    super(message);
    this.name = "ProfitRouterError";
  }
}

export type ScorePolicyVersion = Readonly<{
  id: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  weightsBps: Readonly<{
    expectedCostPerUsableSuccess: number;
    reliability: number;
    quality: number;
    latency: number;
  }>;
  hysteresisThresholdBps: number;
  stickyOverrideThresholdBps: number;
  stickyTtlSeconds: number;
  tieBreak: "ROUTE_VERSION_ID_ASC";
  autoLearningEnabled: false;
  publishedAt: string;
}>;

export type ScoreCandidateInput = Readonly<{
  foundation: CandidateFoundationEvaluation;
  reliabilityPpm: number;
  qualityPpm: number;
  p95LatencyMs: number;
}>;

export type RationalScore = Readonly<{
  numerator: string;
  denominator: string;
  floorBps: number;
}>;

export type CandidateScoreEvidence = Readonly<{
  routeVersionId: string;
  eligible: boolean;
  excludedByHardGates: readonly RouteHardGateCode[];
  components: Readonly<{
    cost: RationalScore | null;
    reliability: RationalScore | null;
    quality: RationalScore | null;
    latency: RationalScore | null;
  }>;
  weightedScore: RationalScore | null;
}>;

export type ScoreSelectionReason =
  | "HIGHEST_SCORE"
  | "DETERMINISTIC_TIE_BREAK"
  | "HYSTERESIS_HOLD"
  | "STICKY_HOLD"
  | "STICKY_OVERRIDDEN"
  | "INCUMBENT_INELIGIBLE";

export type ShadowScoreDecision = Readonly<{
  decisionId: string;
  foundationPolicyVersionId: string;
  scorePolicyVersionId: string;
  mode: "SHADOW";
  evaluatedAt: string;
  rawWinnerRouteVersionId: string;
  selectedRouteVersionId: string;
  selectionReason: ScoreSelectionReason;
  incumbentRouteVersionId: string | null;
  stickyKeyHash: string | null;
  candidates: readonly CandidateScoreEvidence[];
  dispatchMutationPerformed: false;
}>;

export type ShadowScoreRequest = Readonly<{
  decisionId: string;
  candidates: readonly ScoreCandidateInput[];
  incumbentRouteVersionId?: string | null;
}>;

export type ShadowStickyAssignment = Readonly<{
  routeVersionId: string;
  expiresAt: string;
}>;

export type ShadowScoreReplayContext = Readonly<{
  evaluatedAt: string;
  stickyKeyHash: string | null;
  stickyAssignmentBefore: ShadowStickyAssignment | null;
}>;

export type ShadowScoreExecution = Readonly<{
  decision: ShadowScoreDecision;
  replayContext: ShadowScoreReplayContext;
}>;

export type RouteOutcomeStatus =
  | "USABLE_SUCCESS"
  | "PROVIDER_FAILURE"
  | "INGEST_FAILURE"
  | "DELIVERY_FAILURE"
  | "POLICY_REJECTED";

export type RouteOutcomeObservation = Readonly<{
  observationId: string;
  operationId: string;
  metricSignature: RouteMetricSignature;
  status: RouteOutcomeStatus;
  qualityPpm: number | null;
  latencyMs: number;
  observedAt: string;
}>;

export type MetricAggregationPolicyVersion = Readonly<{
  id: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  windowSeconds: number;
  minimumSamples: number;
  publishedAt: string;
}>;

export type RouteMetricAggregate = Readonly<{
  metricPolicyVersionId: string;
  signatureHash: string;
  metricSignature: RouteMetricSignature;
  windowStart: string;
  windowEnd: string;
  sampleCount: number;
  usableSuccessCount: number;
  ratedSuccessCount: number;
  readiness: "READY" | "INSUFFICIENT_SAMPLES";
  reliabilityPpm: number;
  qualityPpm: number | null;
  p95LatencyMs: number;
  observationsHash: string;
}>;

export type ShadowDecisionRecord = Readonly<{
  sequence: number;
  decisionId: string;
  recordedAt: string;
  previousRecordHash: string | null;
  recordHash: string;
  scorePolicy: ScorePolicyVersion;
  request: ShadowScoreRequest;
  replayContext: ShadowScoreReplayContext;
  decision: ShadowScoreDecision;
}>;

export type ShadowReplayResult = Readonly<{
  decisionId: string;
  replayedAt: string;
  matched: true;
  originalRecordHash: string;
  replayedDecisionHash: string;
  dispatchMutationPerformed: false;
}>;

export type ShadowMetricsReport = Readonly<{
  decisionCount: number;
  actualRouteKnownCount: number;
  routeAgreementBps: number | null;
  projectedReliabilityDeltaPpm: number | null;
  projectedQualityDeltaPpm: number | null;
  selectedHardGateViolationCount: number;
  dispatchMutationCount: 0;
}>;

export type CanaryStageBps = 100 | 500 | 1000 | 2500 | 5000 | 10000;

export type ExactCanaryPolicyVersion = Readonly<{
  id: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  exactEquivalenceGroupId: string;
  safeRouteVersionId: string;
  candidateRouteVersionId: string;
  stagesBps: readonly [100, 500, 1000, 2500, 5000, 10000];
  minimumShadowDecisions: number;
  minimumSamplesPerStage: number;
  minimumObservationSeconds: number;
  maximumReliabilityRegressionPpm: number;
  maximumQualityRegressionPpm: number;
  maximumP95LatencyRegressionBps: number;
  minimumActualCostReconciliationBps: number;
  requiredApprovalRoles: readonly ["FINANCE", "RELIABILITY"];
  cohortOrder: "ADMIN_INTERNAL_FIRST";
  assignmentHash: "SHA256_MOD_10000";
  publishedAt: string;
}>;

export type CanaryApproval = Readonly<{
  approvalId: string;
  actorId: string;
  role: "FINANCE" | "RELIABILITY";
  policyVersionId: string;
  approvedAt: string;
}>;

export type CanaryReadinessEvidence = Readonly<{
  evidenceId: string;
  policyVersionId: string;
  exactEquivalenceGroupId: string;
  shadowDecisionCount: number;
  exactReplayMatchCount: number;
  selectedHardGateViolationCount: number;
  dispatchMutationCount: number;
  rollbackDrillPassed: boolean;
  observedAt: string;
}>;

export type CanaryGateObservation = Readonly<{
  observationId: string;
  policyVersionId: string;
  stageBps: CanaryStageBps;
  windowStartedAt: string;
  windowEndedAt: string;
  sampleCount: number;
  marginFloorBreachCount: number;
  hardGateViolationCount: number;
  financialAuthorityConflictCount: number;
  actualCostReconciliationBps: number;
  reliabilityRegressionPpm: number;
  qualityRegressionPpm: number;
  p95LatencyRegressionBps: number;
}>;

export type CanaryControllerState =
  | "DRAFT"
  | "ARMED"
  | "RUNNING"
  | "ROLLED_BACK"
  | "COMPLETED";

export type CanaryRollbackReason =
  | "MANUAL_KILL_SWITCH"
  | "MARGIN_FLOOR_BREACH"
  | "HARD_GATE_VIOLATION"
  | "FINANCIAL_AUTHORITY_CONFLICT"
  | "ACTUAL_COST_RECONCILIATION_REGRESSION"
  | "RELIABILITY_REGRESSION"
  | "QUALITY_REGRESSION"
  | "P95_LATENCY_REGRESSION";

export type CanaryControllerSnapshot = Readonly<{
  policyVersionId: string;
  state: CanaryControllerState;
  currentStageBps: 0 | CanaryStageBps;
  completedStagesBps: readonly CanaryStageBps[];
  approvals: readonly CanaryApproval[];
  readinessEvidenceId: string | null;
  rollbackReason: CanaryRollbackReason | null;
  newAssignmentRouteVersionId: string;
  inFlightPolicy: "COMPLETE_PINNED_NO_REDISPATCH";
  acceptedQuotePolicy: "HONOR_UNTIL_EXPIRY";
  financialAuthorityPolicy: "ONE_SOURCE_PER_COHORT";
  externalDispatchPerformed: false;
}>;

export type CanaryAssignmentPlan = Readonly<{
  cohortKeyHash: string;
  bucketBps: number;
  cohort: "ADMIN_INTERNAL" | "PUBLIC";
  selectedRouteVersionId: string;
  financialAuthority: "EXACT_CANARY_ENGINE" | "SAFE_ENGINE";
  dispatchMutationPerformed: false;
}>;

export type Gate13LocalEvidence = Readonly<{
  evidenceId: string;
  routerFoundationTestsPassed: boolean;
  scorePolicyTestsPassed: boolean;
  shadowDecisionCount: number;
  replayMatchCount: number;
  selectedHardGateViolationCount: number;
  marginFloorBreachCount: number;
  qualityRegressionPpm: number;
  maximumAllowedQualityRegressionPpm: number;
  reliabilityRegressionPpm: number;
  maximumAllowedReliabilityRegressionPpm: number;
  p95LatencyRegressionBps: number;
  maximumAllowedP95LatencyRegressionBps: number;
  actualCostReconciliationBps: number;
  minimumActualCostReconciliationBps: number;
  canaryStagesCompletedBps: readonly CanaryStageBps[];
  rollbackDrillPassed: boolean;
  decisionChainVerified: boolean;
  externalDispatchCount: number;
  observedAt: string;
}>;

export type Gate13FormalDependencies = Readonly<{
  formalGates6Through12Passed: boolean;
  representativeProductionDataAvailable: boolean;
  productionExactEquivalenceGroupCertified: boolean;
  realExactCanaryCompleted: boolean;
  productionRollbackDrillPassed: boolean;
  namedProductFinanceReliabilityApprovals: boolean;
}>;

export type Gate13DecisionReason =
  | "LOCAL_FOUNDATION_TESTS_FAILED"
  | "LOCAL_SCORE_TESTS_FAILED"
  | "SHADOW_REPLAY_INCOMPLETE"
  | "HARD_GATE_VIOLATION"
  | "MARGIN_FLOOR_BREACH"
  | "QUALITY_REGRESSION"
  | "RELIABILITY_REGRESSION"
  | "P95_LATENCY_REGRESSION"
  | "ACTUAL_COST_RECONCILIATION_BELOW_TARGET"
  | "CANARY_LADDER_INCOMPLETE"
  | "ROLLBACK_DRILL_NOT_PASSED"
  | "DECISION_CHAIN_NOT_VERIFIED"
  | "LOCAL_EXTERNAL_DISPATCH_DETECTED"
  | "FORMAL_GATES_6_12_NOT_PASSED"
  | "REPRESENTATIVE_PRODUCTION_DATA_MISSING"
  | "PRODUCTION_EXACT_GROUP_NOT_CERTIFIED"
  | "REAL_EXACT_CANARY_NOT_COMPLETED"
  | "PRODUCTION_ROLLBACK_DRILL_NOT_PASSED"
  | "NAMED_APPROVALS_MISSING";

export type Gate13Decision = Readonly<{
  gate: 13;
  evaluatedAt: string;
  localImplementationDecision: "PASS" | "HOLD";
  formalGateDecision: "PASS" | "HOLD";
  localReasons: readonly Gate13DecisionReason[];
  formalBlockers: readonly Gate13DecisionReason[];
  productionAuthorizationGranted: boolean;
}>;
