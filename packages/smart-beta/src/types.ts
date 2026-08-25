export type SmartProfileKey =
  | "BEST_VALUE"
  | "CINEMATIC"
  | "FAST_DRAFT"
  | "HIGH_CONSISTENCY";

export type SmartCandidateVersion = Readonly<{
  familyVersionId: string;
  modelVersionId: string;
  routeVersionId: string;
  exactCertified: boolean;
  smartProfileCertified: boolean;
}>;

export type SmartProfileVersion = Readonly<{
  id: string;
  profileKey: SmartProfileKey;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  displayName: string;
  disclosureVersionId: string;
  automaticSelectionDisclosure: string;
  resultModelDisclosure: string;
  candidates: readonly SmartCandidateVersion[];
  economicOutputMayBeCalledPremium: false;
  publishedAt: string;
}>;

export type SmartOptInConsent = Readonly<{
  consentId: string;
  userId: string;
  profileVersionId: string;
  disclosureVersionId: string;
  action: "SMART_OPT_IN";
  acceptedAt: string;
}>;

export type SmartOptOutEvent = Readonly<{
  revocationId: string;
  consentId: string;
  userId: string;
  action: "SMART_OPT_OUT";
  revokedAt: string;
}>;

export type SmartSelectionAuthorization = Readonly<{
  authorizationId: string;
  userId: string;
  profileVersionId: string;
  profileKey: SmartProfileKey;
  consentId: string;
  disclosureVersionId: string;
  automaticSelection: true;
  preSelectionDisclosure: string;
  candidateVersions: readonly SmartCandidateVersion[];
  selectionAuthorityGranted: true;
  hiddenSubstitutionAllowed: false;
  externalDispatchPerformed: false;
  authorizedAt: string;
}>;

export type SmartResultDisclosure = Readonly<{
  authorizationId: string;
  profileVersionId: string;
  profileDisplayName: string;
  automaticSelectionWasUsed: true;
  actualFamilyVersionId: string;
  actualModelVersionId: string;
  actualRouteVersionId: string;
  disclosureText: string;
  economicOutputCalledPremium: false;
  dispatchMutationPerformed: false;
}>;

export class SmartBetaError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SMART_PROFILE"
      | "IMMUTABLE_SMART_PROFILE"
      | "DUPLICATE_SMART_PROFILE_SEQUENCE"
      | "SMART_PROFILE_NOT_FOUND"
      | "INVALID_SMART_CONSENT"
      | "SMART_CONSENT_CONFLICT"
      | "SMART_OPT_IN_REQUIRED"
      | "SMART_CONSENT_REVOKED"
      | "SMART_PROFILE_NOT_ELIGIBLE"
      | "HIDDEN_SUBSTITUTION_DENIED"
      | "INVALID_RESULT_DISCLOSURE"
      | "INVALID_FEEDBACK"
      | "FEEDBACK_CONFLICT"
      | "INVALID_EVALUATION_POLICY"
      | "IMMUTABLE_EVALUATION_POLICY"
      | "DUPLICATE_EVALUATION_POLICY_SEQUENCE"
      | "EVALUATION_POLICY_NOT_FOUND"
      | "INVALID_AUTOMATED_EVALUATION"
      | "AUTOMATED_EVALUATION_CONFLICT"
      | "INVALID_EXPLORATION_POLICY"
      | "EXPLORATION_REQUEST_CONFLICT"
      | "EXPLORATION_NOT_ELIGIBLE"
      | "EXPLORATION_MARGIN_FLOOR_BREACH"
      | "EXPLORATION_BUDGET_INSUFFICIENT"
      | "EXPLORATION_RESERVATION_NOT_FOUND"
      | "EXPLORATION_SETTLEMENT_CONFLICT"
      | "INVALID_EXPERIMENT_POLICY"
      | "IMMUTABLE_EXPERIMENT_POLICY"
      | "DUPLICATE_EXPERIMENT_POLICY_SEQUENCE"
      | "EXPERIMENT_POLICY_NOT_FOUND"
      | "EXPERIMENT_REQUEST_CONFLICT"
      | "EXPERIMENT_KILL_SWITCH_ACTIVE"
      | "INVALID_EXPERIMENT_ENROLLMENT"
      | "INVALID_EXPERIMENT_TRANSITION"
      | "EXPERIMENT_OUTPUT_CONFLICT"
      | "INVALID_CFO_ADVISOR_POLICY"
      | "IMMUTABLE_CFO_ADVISOR_POLICY"
      | "DUPLICATE_CFO_ADVISOR_POLICY_SEQUENCE"
      | "CFO_ADVISOR_POLICY_NOT_FOUND"
      | "INVALID_CFO_METRIC_SNAPSHOT"
      | "CFO_ADVISOR_REPORT_CONFLICT"
      | "INVALID_GATE_14_EVIDENCE",
    message: string,
  ) {
    super(message);
    this.name = "SmartBetaError";
  }
}

export type SmartOutcomeIdentity = Readonly<{
  operationId: string;
  authorizationId: string;
  profileVersionId: string;
  familyVersionId: string;
  modelVersionId: string;
  routeVersionId: string;
}>;

export type FeedbackReasonCode =
  | "OUTPUT_QUALITY"
  | "PROMPT_ALIGNMENT"
  | "SPEED"
  | "VALUE"
  | "CONSISTENCY";

export type SmartFeedbackCommand = Readonly<{
  eventId: string;
  actorUserId: string;
  operationOwnerUserId: string;
  outcome: SmartOutcomeIdentity;
  rating: 1 | 2 | 3 | 4 | 5;
  reasonCodes: readonly FeedbackReasonCode[];
  revision: number;
  supersedesEventId: string | null;
  occurredAt: string;
}>;

export type SmartFeedbackEvent = Readonly<{
  eventId: string;
  feedbackKeyHash: string;
  outcome: SmartOutcomeIdentity;
  rating: 1 | 2 | 3 | 4 | 5;
  reasonCodes: readonly FeedbackReasonCode[];
  revision: number;
  supersedesEventId: string | null;
  occurredAt: string;
  eventHash: string;
}>;

export type EvaluationPolicyVersion = Readonly<{
  id: string;
  policyKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  automatedMetricWeightsBps: Readonly<{
    technical: number;
    semantic: number;
    safety: number;
  }>;
  compositeWeightsBps: Readonly<{
    automatedQuality: number;
    userSatisfaction: number;
  }>;
  minimumAutomatedSamples: number;
  minimumFeedbackSamples: number;
  publishedAt: string;
}>;

export type AutomatedEvaluationInput = Readonly<{
  evaluationId: string;
  outcome: SmartOutcomeIdentity;
  evaluatorVersionId: string;
  policyVersionId: string;
  technicalPpm: number;
  semanticPpm: number;
  safetyPpm: number;
  evaluatedAt: string;
}>;

export type AutomatedEvaluationRecord = Readonly<AutomatedEvaluationInput & {
  qualityPpm: number;
  evaluationHash: string;
}>;

export type SmartEvaluationReport = Readonly<{
  policyVersionId: string;
  profileVersionId: string;
  familyVersionId: string;
  modelVersionId: string;
  routeVersionId: string;
  automatedSampleCount: number;
  feedbackSampleCount: number;
  automatedQualityPpm: number | null;
  userSatisfactionPpm: number | null;
  compositeScorePpm: number | null;
  readiness: "READY" | "INSUFFICIENT_SAMPLES";
  feedbackReasonCounts: Readonly<Record<FeedbackReasonCode, number>>;
  evidenceHash: string;
  routingMutationPerformed: false;
  autoLearningPerformed: false;
}>;

export type ExplorationBudgetPolicyVersion = Readonly<{
  id: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  allocationBps: number;
  totalBudgetMicrousd: string;
  maximumIncrementalCostPerOperationMicrousd: string;
  maximumSelectionsPerUser: number;
  eligibleProfileVersionIds: readonly string[];
  windowStartsAt: string;
  windowEndsAt: string;
  platformFunded: true;
  customerSurchargeAllowed: false;
  assignmentHash: "SHA256_MOD_10000";
  publishedAt: string;
}>;

export type ExplorationLedgerEntry = Readonly<{
  sequence: number;
  entryId: string;
  reservationId: string;
  type: "RESERVE" | "SETTLE" | "RELEASE";
  amountMicrousd: string;
  occurredAt: string;
  previousEntryHash: string | null;
  entryHash: string;
}>;

export type ExplorationReservation = Readonly<{
  reservationId: string;
  requestId: string;
  userKeyHash: string;
  profileVersionId: string;
  reservedIncrementalCostMicrousd: string;
  settledIncrementalCostMicrousd: string;
  releasedIncrementalCostMicrousd: string;
  state: "RESERVED" | "SETTLED" | "RELEASED";
  createdAt: string;
  terminalAt: string | null;
}>;

export type ExplorationPlan = Readonly<{
  requestId: string;
  policyVersionId: string;
  assignmentKeyHash: string;
  bucketBps: number;
  selection: "CONTROL" | "EXPLORATION";
  reservationId: string | null;
  reservedIncrementalCostMicrousd: string;
  customerQuotedCreditsUnchanged: true;
  customerSurchargeMicrousd: "0";
  platformFunded: true;
  dispatchMutationPerformed: false;
  reason:
    | "BUCKET_CONTROL"
    | "EXPLORATION_RESERVED"
    | "KILL_SWITCH_ACTIVE";
}>;

export type ExplorationBudgetSnapshot = Readonly<{
  policyVersionId: string;
  allocationBps: number;
  totalBudgetMicrousd: string;
  availableBudgetMicrousd: string;
  reservedBudgetMicrousd: string;
  settledBudgetMicrousd: string;
  releasedBudgetMicrousd: string;
  killSwitchActive: boolean;
  reservationCount: number;
  ledgerEntryCount: number;
  ledgerChainValid: boolean;
  customerSurchargeMicrousd: "0";
  externalDispatchPerformed: false;
}>;

export type SmartExperimentKind =
  | "DRAFT_TO_FINAL"
  | "SMART_VARIATIONS"
  | "RELAXED_QUEUE";

export type SmartExperimentContract =
  | Readonly<{
    kind: "DRAFT_TO_FINAL";
    draftOutputLabel: "DRAFT";
    finalRequiresSeparateQuote: true;
    finalRequiresExplicitConfirmation: true;
  }>
  | Readonly<{
    kind: "SMART_VARIATIONS";
    maxVariations: number;
    requirePerOutputModelDisclosure: true;
  }>
  | Readonly<{
    kind: "RELAXED_QUEUE";
    maxQueueWaitSeconds: number;
    maxConcurrency: number;
    progressMode: "STAGE_ONLY_NO_PERCENTAGE";
  }>;

export type SmartExperimentPolicyVersion = Readonly<{
  id: string;
  experimentKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  kind: SmartExperimentKind;
  eligibleProfileVersionIds: readonly string[];
  explorationPolicyVersionId: string;
  disclosureVersionId: string;
  disclosureText: string;
  minimumSatisfactionPpm: number;
  hardFloorMarginBps: number;
  windowStartsAt: string;
  windowEndsAt: string;
  platformSubsidized: true;
  customerContractMutationAllowed: false;
  contract: SmartExperimentContract;
  publishedAt: string;
}>;

export type SmartExperimentOutput = Readonly<{
  outputId: string;
  index: number;
  stage: "DRAFT" | "FINAL" | "VARIATION" | "RELAXED_RESULT";
  actualFamilyVersionId: string;
  actualModelVersionId: string;
  actualRouteVersionId: string;
  modelDisclosed: true;
  evidenceHash: string;
}>;

export type SmartExperimentRun = Readonly<{
  runId: string;
  policyVersionId: string;
  kind: SmartExperimentKind;
  userKeyHash: string;
  authorizationId: string;
  profileVersionId: string;
  explorationReservationId: string;
  disclosureVersionId: string;
  disclosureText: string;
  contract: SmartExperimentContract;
  requestedVariations: number | null;
  finalConfirmation: Readonly<{
    confirmationId: string;
    finalQuoteVersionId: string;
    confirmedAt: string;
  }> | null;
  outputs: readonly SmartExperimentOutput[];
  state: "PLANNED" | "COMPLETED";
  platformSubsidized: true;
  customerSurchargeMicrousd: "0";
  customerContractMutationAllowed: false;
  inFlightPolicy: "COMPLETE_PINNED_NO_REDISPATCH";
  dispatchMutationPerformed: false;
  createdAt: string;
  completedAt: string | null;
}>;

export type SmartExperimentSnapshot = Readonly<{
  policyVersionId: string;
  kind: SmartExperimentKind;
  killSwitchActive: boolean;
  killSwitchReason: "MANUAL" | "SATISFACTION_REGRESSION" | "MARGIN_FLOOR_BREACH" | null;
  newEnrollmentAllowed: boolean;
  plannedRunCount: number;
  completedRunCount: number;
  customerSurchargeMicrousd: "0";
  externalDispatchPerformed: false;
}>;

export type CfoAdvisorProposalKind =
  | "PRICE_DRAFT"
  | "ROUTE_WEIGHT_DRAFT"
  | "TREASURY_DRAFT"
  | "SUSPENSION_DRAFT";

export type CfoAdvisorSignal =
  | "MARGIN_FLOOR_BREACH"
  | "LOSS_MAKING_ROUTE"
  | "COST_SHOCK"
  | "LOW_PROVIDER_RUNWAY"
  | "ROUTE_CONCENTRATION"
  | "UNRECONCILED_EXPOSURE";

export type CfoAdvisorPolicyVersion = Readonly<{
  id: string;
  policyKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  minimumSampleCount: number;
  targetMarginBps: number;
  hardFloorMarginBps: number;
  costShockTriggerBps: number;
  maximumRouteConcentrationBps: number;
  minimumProviderRunwayDays: number;
  targetProviderRunwayDays: number;
  maximumUnreconciledExposureMicrousd: string;
  reportingCadence: "WEEKLY";
  advisorAuthority: "PROPOSE_AND_SIMULATE_ONLY";
  publishedAt: string;
}>;

export type CfoAdvisorMetricSnapshot = Readonly<{
  snapshotId: string;
  routeVersionId: string;
  providerAccountVersionId: string;
  windowStartsAt: string;
  windowEndsAt: string;
  sampleCount: number;
  netEconomicValueMicrousd: string;
  providerCogsExpectedMicrousd: string;
  providerCogsP90Microusd: string;
  providerCogsMaximumMicrousd: string;
  providerCogsActualMicrousd: string;
  observedUnitCostMicrousd: string;
  baselineUnitCostMicrousd: string;
  providerCashBalanceMicrousd: string;
  averageDailyBurnMicrousd: string;
  unreconciledExposureMicrousd: string;
  routeConcentrationBps: number;
  sanitizedMetrics: true;
  containsUserIdentifiers: false;
  containsPromptsOrAssets: false;
  containsCredentials: false;
}>;

export type CfoAdvisorScenario = Readonly<{
  scenario: "CURRENT" | "RECOMMENDED_PRICE";
  customerEconomicValueMicrousd: string;
  expectedCogsMicrousd: string;
  p90CogsMicrousd: string;
  maximumCogsMicrousd: string;
  expectedMarginBps: string;
  p90MarginBps: string;
  maximumMarginBps: string;
}>;

export type CfoAdvisorProposal = Readonly<{
  sequence: number;
  proposalId: string;
  kind: CfoAdvisorProposalKind;
  signal: CfoAdvisorSignal;
  routeVersionId: string;
  recommendation: Readonly<{
    recommendedCustomerValueMicrousd: string | null;
    proposedMaximumRouteWeightBps: number | null;
    recommendedTreasuryFundingMicrousd: string | null;
    suspensionRecommended: boolean;
  }>;
  simulations: readonly CfoAdvisorScenario[];
  status: "ADVISORY_DRAFT";
  nextRequiredAction: "MAKER_REVIEW";
  executionAuthority: false;
  publishAllowed: false;
  creditMutationAllowed: false;
  providerTopUpAllowed: false;
  secretActivationAllowed: false;
  journalDeletionAllowed: false;
  previousProposalHash: string | null;
  proposalHash: string;
}>;

export type CfoAdvisorReport = Readonly<{
  reportId: string;
  policyVersionId: string;
  metricSnapshotId: string;
  metricsEvidenceHash: string;
  routeVersionId: string;
  generatedAt: string;
  reportingCadence: "WEEKLY";
  signals: readonly CfoAdvisorSignal[];
  proposals: readonly CfoAdvisorProposal[];
  sanitizedInputOnly: true;
  deterministicSimulation: true;
  advisorAuthority: "PROPOSE_AND_SIMULATE_ONLY";
  publishedDecisionCreated: false;
  runtimeMutationPerformed: false;
  reportHash: string;
}>;

export type CfoAdvisorSnapshot = Readonly<{
  policyVersionId: string;
  reportCount: number;
  proposalCount: number;
  proposalChainValid: boolean;
  publishedDecisionCount: 0;
  creditMutationCount: 0;
  providerTopUpCount: 0;
  runtimeMutationPerformed: false;
}>;

export type Gate14LocalDecisionReason =
  | "OPT_IN_PROFILE_TESTS_FAILED"
  | "FEEDBACK_EVALUATION_TESTS_FAILED"
  | "EXPLORATION_BUDGET_TESTS_FAILED"
  | "EXPERIMENT_CONTRACT_TESTS_FAILED"
  | "CFO_ADVISOR_TESTS_FAILED"
  | "OPT_IN_DISCLOSURE_INCOMPLETE"
  | "HIDDEN_SUBSTITUTION_DETECTED"
  | "EVALUATION_EVIDENCE_INCOMPLETE"
  | "EXPLORATION_ALLOCATION_OUT_OF_BOUNDS"
  | "EXPLORATION_RECONCILIATION_FAILED"
  | "CUSTOMER_SURCHARGE_DETECTED"
  | "EXPERIMENT_CONTRACTS_INCOMPLETE"
  | "OUTPUT_DISCLOSURE_INCOMPLETE"
  | "MARGIN_FLOOR_BREACH"
  | "SATISFACTION_BELOW_LIMIT"
  | "KILL_SWITCH_DRILL_NOT_PASSED"
  | "CFO_ADVISOR_EVIDENCE_INCOMPLETE"
  | "CFO_ADVISOR_CHAIN_NOT_VERIFIED"
  | "CFO_ADVISOR_EXECUTION_AUTHORITY_DETECTED"
  | "LOCAL_EXTERNAL_DISPATCH_DETECTED";

export type Gate14FormalBlocker =
  | "FORMAL_GATE_13_NOT_PASSED"
  | "REPRESENTATIVE_SMART_BETA_DATA_MISSING"
  | "REAL_CONSENT_DISCLOSURE_EVIDENCE_MISSING"
  | "FUNDED_EXPLORATION_BUDGET_NOT_APPROVED"
  | "PRIVACY_LEGAL_EXPERIMENT_APPROVAL_MISSING"
  | "REAL_SMART_BETA_CANARY_NOT_COMPLETED"
  | "PRODUCTION_KILL_SWITCH_DRILL_NOT_PASSED"
  | "OBSERVED_SATISFACTION_MARGIN_LIMITS_NOT_PASSED"
  | "NAMED_APPROVALS_MISSING";

export type Gate14LocalEvidence = Readonly<{
  evidenceId: string;
  optInProfileTestsPassed: boolean;
  feedbackEvaluationTestsPassed: boolean;
  explorationBudgetTestsPassed: boolean;
  experimentContractTestsPassed: boolean;
  cfoAdvisorTestsPassed: boolean;
  smartAuthorizationCount: number;
  resultDisclosureCount: number;
  hiddenSubstitutionViolationCount: number;
  feedbackEventCount: number;
  automatedEvaluationCount: number;
  readyEvaluationReportCount: number;
  explorationAllocationBps: number;
  explorationReservationCount: number;
  explorationReservedMicrousd: string;
  explorationSettledMicrousd: string;
  explorationReleasedMicrousd: string;
  customerExplorationSurchargeMicrousd: string;
  experimentPolicyCount: number;
  experimentCompletedRunCount: number;
  experimentOutputCount: number;
  experimentDisclosedOutputCount: number;
  marginFloorBreachCount: number;
  observedSatisfactionPpm: number;
  minimumSatisfactionPpm: number;
  killSwitchDrillPassed: boolean;
  cfoAdvisorReportCount: number;
  cfoAdvisorProposalCount: number;
  cfoAdvisorProposalChainVerified: boolean;
  cfoAdvisorRuntimeMutationCount: number;
  externalDispatchCount: number;
  observedAt: string;
}>;

export type Gate14FormalDependencies = Readonly<{
  formalGate13Passed: boolean;
  representativeSmartBetaDataAvailable: boolean;
  realConsentDisclosureEvidenceVerified: boolean;
  fundedExplorationBudgetApproved: boolean;
  privacyLegalExperimentApproval: boolean;
  realSmartBetaCanaryCompleted: boolean;
  productionKillSwitchDrillPassed: boolean;
  observedSatisfactionAndMarginLimitsPassed: boolean;
  namedProductFinanceReliabilityApprovals: boolean;
}>;

export type Gate14Decision = Readonly<{
  gate: 14;
  evaluatedAt: string;
  evidenceHash: string;
  localImplementationDecision: "PASS" | "HOLD";
  formalGateDecision: "PASS" | "HOLD";
  localReasons: readonly Gate14LocalDecisionReason[];
  formalBlockers: readonly Gate14FormalBlocker[];
  productionAuthorizationGranted: boolean;
  smartBetaActivationAuthorized: boolean;
  decisionHash: string;
}>;
