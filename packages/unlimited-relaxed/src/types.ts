export class UnlimitedRelaxedError extends Error {
  constructor(
    public readonly code:
      | "INVALID_OFFER_POLICY"
      | "IMMUTABLE_OFFER_POLICY"
      | "DUPLICATE_OFFER_POLICY_SEQUENCE"
      | "OFFER_POLICY_NOT_FOUND"
      | "INVALID_PILOT_AUTHORIZATION"
      | "PILOT_AUTHORIZATION_CONFLICT"
      | "PILOT_NOT_ELIGIBLE"
      | "INVALID_USAGE_REQUEST"
      | "INVALID_COHORT_BUDGET_POLICY"
      | "COHORT_BUDGET_REQUEST_CONFLICT"
      | "COHORT_BUDGET_NOT_ELIGIBLE"
      | "COHORT_BUDGET_INSUFFICIENT"
      | "COHORT_RESERVATION_NOT_FOUND"
      | "COHORT_SETTLEMENT_CONFLICT"
      | "INVALID_RISK_MODEL_POLICY"
      | "INVALID_RISK_OBSERVATIONS"
      | "RISK_REPORT_CONFLICT"
      | "INVALID_PILOT_CONTROL_POLICY"
      | "INVALID_PILOT_CONTROL_EVIDENCE"
      | "PILOT_CONTROL_REQUEST_CONFLICT"
      | "PILOT_CONTROL_APPROVAL_DENIED"
      | "PILOT_CONTROL_TRANSITION_DENIED"
      | "INVALID_GATE_15_EVIDENCE",
    message: string,
  ) {
    super(message);
    this.name = "UnlimitedRelaxedError";
  }
}

export type UnlimitedRelaxedRouteVersion = Readonly<{
  routeVersionId: string;
  familyVersionId: string;
  modelVersionId: string;
  economicCertified: true;
  maximumResolution: Readonly<{ width: number; height: number }>;
  maximumDurationSeconds: number;
}>;

export type UnlimitedRelaxedOfferPolicyVersion = Readonly<{
  id: string;
  offerKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  offering:
    | Readonly<{
      kind: "UNLIMITED_RELAXED_DRAFT";
      displayName: "Unlimited Relaxed Draft";
      publishedMonthlyGenerationCap: null;
    }>
    | Readonly<{
      kind: "HIGH_MONTHLY_ALLOWANCE";
      displayName: "High Monthly Allowance";
      publishedMonthlyGenerationCap: number;
    }>;
  eligibleSubscriptionPlanVersionIds: readonly string[];
  restrictedRoutes: readonly UnlimitedRelaxedRouteVersion[];
  queue: Readonly<{
    mode: "SHARED_RELAXED";
    maximumConcurrency: number;
    maximumPublishedWaitSeconds: number;
    progressMode: "STAGE_ONLY_NO_PERCENTAGE";
  }>;
  includedOutput: Readonly<{
    purpose: "DRAFT_ONLY";
    maximumResolution: Readonly<{ width: number; height: number }>;
    maximumDurationSeconds: number;
  }>;
  fairUse: Readonly<{
    versionId: string;
    termsVersionId: string;
    disclosureText: string;
    userVisible: true;
    enforcementDisclosure: string;
    hiddenCapAllowed: false;
    apiAutomationAllowed: false;
    batchAutomationAllowed: false;
  }>;
  premiumOrFinalRequiresCredits: true;
  hiddenModelSubstitutionAllowed: false;
  productionActivationAllowed: false;
  publishedAt: string;
}>;

export type UnlimitedRelaxedPilotAuthorization = Readonly<{
  authorizationId: string;
  userKeyHash: string;
  policyVersionId: string;
  subscriptionPlanVersionId: string;
  fairUseVersionId: string;
  termsVersionId: string;
  pilotCohortId: string;
  pilotCohortMembershipId: string;
  explicitPilotOptInId: string;
  authorizedAt: string;
  expiresAt: string;
  hiddenCapAccepted: false;
  externalDispatchPerformed: false;
}>;

export type UnlimitedRelaxedUsageDecision = Readonly<{
  requestId: string;
  policyVersionId: string;
  authorizationId: string;
  decision:
    | "INCLUDED_RELAXED"
    | "REQUIRES_CREDITS"
    | "NOT_ELIGIBLE";
  reason:
    | "RELAXED_DRAFT_INCLUDED"
    | "PREMIUM_OR_FINAL_REQUIRES_CREDITS"
    | "API_AUTOMATION_PROHIBITED"
    | "BATCH_AUTOMATION_PROHIBITED"
    | "ROUTE_NOT_INCLUDED"
    | "OUTPUT_LIMIT_EXCEEDED"
    | "AUTHORIZATION_EXPIRED";
  actualRouteVersionId: string | null;
  actualFamilyVersionId: string | null;
  actualModelVersionId: string | null;
  modelDisclosureRequired: true;
  queueMode: "SHARED_RELAXED";
  maximumConcurrency: number;
  maximumPublishedWaitSeconds: number;
  progressMode: "STAGE_ONLY_NO_PERCENTAGE";
  hiddenCapApplied: false;
  customerCreditsReserved: false;
  dispatchMutationPerformed: false;
}>;

export type UnlimitedCohortBudgetPolicyVersion = Readonly<{
  id: string;
  cohortId: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  offerPolicyVersionId: string;
  netCohortSubscriptionEconomicValueMicrousd: string;
  approvedCogsRatioBps: number;
  maximumCogsPerOperationMicrousd: string;
  periodStartsAt: string;
  periodEndsAt: string;
  calculation: "NET_COHORT_VALUE_TIMES_APPROVED_COGS_RATIO_FLOOR";
  budgetAuthority: "LOCAL_SIMULATION_ONLY";
  pilotActivationAllowed: false;
  publishedAt: string;
}>;

export type UnlimitedCohortBudgetReservation = Readonly<{
  reservationId: string;
  operationId: string;
  cohortId: string;
  policyVersionId: string;
  authorizationId: string;
  userKeyHash: string;
  routeVersionId: string;
  familyVersionId: string;
  modelVersionId: string;
  reservedMaximumCogsMicrousd: string;
  settledActualCogsMicrousd: string;
  releasedCogsMicrousd: string;
  state: "RESERVED" | "SETTLED" | "RELEASED";
  createdAt: string;
  terminalAt: string | null;
  customerCreditsCharged: false;
  externalDispatchPerformed: false;
}>;

export type UnlimitedCohortBudgetEntry = Readonly<{
  sequence: number;
  entryId: string;
  reservationId: string;
  operationId: string;
  type: "RESERVE" | "SETTLE" | "RELEASE";
  amountMicrousd: string;
  reason: "MAXIMUM_COGS_RESERVED" | "ACTUAL_COGS_VERIFIED" | "UNUSED_RESERVE" | "NO_CHARGE_FAILURE";
  occurredAt: string;
  previousEntryHash: string | null;
  entryHash: string;
}>;

export type UnlimitedCohortBudgetSnapshot = Readonly<{
  policyVersionId: string;
  offerPolicyVersionId: string;
  cohortId: string;
  netCohortSubscriptionEconomicValueMicrousd: string;
  approvedCogsRatioBps: number;
  allowedCohortCogsMicrousd: string;
  availableCohortCogsMicrousd: string;
  reservedCohortCogsMicrousd: string;
  settledCohortCogsMicrousd: string;
  releasedCohortCogsMicrousd: string;
  reservationCount: number;
  ledgerEntryCount: number;
  ledgerChainValid: boolean;
  projectionReconciled: boolean;
  customerCreditsCharged: "0";
  externalDispatchPerformed: false;
  pilotActivationAllowed: false;
}>;

export type UnlimitedRiskModelPolicyVersion = Readonly<{
  id: string;
  policyKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  offerPolicyVersionId: string;
  cohortBudgetPolicyVersionId: string;
  minimumUserSampleCount: number;
  minimumRepresentativeDays: 60;
  minimumFinancialCycles: 2;
  percentiles: readonly [50, 90, 95, 99];
  priceShockBps: readonly number[];
  quantileMethod: "NEAREST_RANK";
  analysisAuthority: "SIMULATE_ONLY";
  pilotActivationAllowed: false;
  publishedAt: string;
}>;

export type UnlimitedUserUsageAggregate = Readonly<{
  aggregateId: string;
  userKeyHash: string;
  operationCount: number;
  actualCogsMicrousd: string;
  sanitizedAggregate: true;
  containsUserIdentifier: false;
  containsPromptOrAsset: false;
}>;

export type UnlimitedRiskScenario = Readonly<{
  scenario: "CURRENT" | "PRICE_SHOCK" | "ALL_USERS_AT_P99";
  shockBps: number;
  projectedCohortCogsMicrousd: string;
  approvedCohortCogsMicrousd: string;
  projectedBudgetLossMicrousd: string;
  budgetBreached: boolean;
}>;

export type UnlimitedRiskReport = Readonly<{
  reportId: string;
  policyVersionId: string;
  offerPolicyVersionId: string;
  cohortBudgetPolicyVersionId: string;
  cohortId: string;
  windowStartsAt: string;
  windowEndsAt: string;
  representativeDayCount: number;
  completedFinancialCycles: number;
  userSampleCount: number;
  operationSampleCount: number;
  totalActualCogsMicrousd: string;
  meanUserCogsMicrousd: string;
  percentilesMicrousd: Readonly<{
    p50: string;
    p90: string;
    p95: string;
    p99: string;
  }>;
  p99ToP50RatioBps: string;
  heavyUserThresholdMicrousd: string;
  heavyUserCount: number;
  heavyUserCogsShareBps: string;
  scenarios: readonly UnlimitedRiskScenario[];
  dataReadiness: "REPRESENTATIVE" | "INSUFFICIENT_DATA";
  representativeBasis: "SIXTY_DAYS" | "TWO_FINANCIAL_CYCLES" | "INSUFFICIENT";
  riskOutcome: "WITHIN_APPROVED_BUDGET" | "BUDGET_BREACH_PROJECTED" | "INSUFFICIENT_DATA";
  decisionUsesAverageOnly: false;
  sanitizedInputOnly: true;
  simulationOnly: true;
  pilotActivationAllowed: false;
  externalDispatchPerformed: false;
  evidenceHash: string;
}>;

export type UnlimitedPilotControlPolicyVersion = Readonly<{
  id: string;
  policyKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  offerPolicyVersionId: string;
  cohortBudgetPolicyVersionId: string;
  riskModelPolicyVersionId: string;
  maximumCohortMembers: number;
  minimumRemainingBudgetBpsForNewSales: number;
  maximumQueueAgeSecondsForNewSales: number;
  requiredOpenApprovalRoles: readonly ["LEGAL", "FINANCE"];
  makerCheckerRequired: true;
  salesStopDefault: true;
  killSwitchMode: "IMMEDIATE_NEW_OPERATION_STOP";
  inFlightPolicy: "SETTLE_OR_RELEASE_NO_REDISPATCH";
  productionActivationAllowed: false;
  publishedAt: string;
}>;

export type UnlimitedPilotControlEvent = Readonly<{
  sequence: number;
  eventId: string;
  type: "OPEN_PROPOSED" | "OPEN_APPROVED" | "SIMULATION_OPENED" | "SALES_STOPPED" | "KILL_SWITCHED" | "HEALTH_EVALUATED";
  changeId: string | null;
  actorKeyHash: string;
  reason:
    | "LOCAL_OPEN_PROPOSAL"
    | "LEGAL_APPROVAL"
    | "FINANCE_APPROVAL"
    | "DUAL_APPROVAL_COMPLETE"
    | "MANUAL_SALES_STOP"
    | "LOW_REMAINING_BUDGET"
    | "QUEUE_AGE_BREACH"
    | "MANUAL_KILL"
    | "RISK_BUDGET_BREACH"
    | "BUDGET_RECONCILIATION_FAILURE"
    | "HEALTHY_NO_CHANGE";
  occurredAt: string;
  previousEventHash: string | null;
  eventHash: string;
}>;

export type UnlimitedPilotControlSnapshot = Readonly<{
  policyVersionId: string;
  state: "CLOSED" | "SIMULATION_OPEN" | "SALES_STOPPED" | "KILLED";
  stopReason: UnlimitedPilotControlEvent["reason"] | null;
  newMemberAdmissionAllowed: boolean;
  existingMemberNewOperationAllowed: boolean;
  inFlightPolicy: "SETTLE_OR_RELEASE_NO_REDISPATCH";
  pendingChangeId: string | null;
  approvalRoles: readonly ("LEGAL" | "FINANCE")[];
  eventCount: number;
  eventChainValid: boolean;
  productionActivationAllowed: false;
  externalDispatchPerformed: false;
}>;

export type UnlimitedPilotAccessDecision = Readonly<{
  policyVersionId: string;
  memberAlreadyAuthorized: boolean;
  currentCohortMemberCount: number;
  maximumCohortMembers: number;
  newMemberAdmissionAllowed: boolean;
  newOperationAllowed: boolean;
  reason: "SIMULATION_OPEN" | "COHORT_MEMBER_LIMIT_REACHED" | "SALES_STOPPED" | "KILL_SWITCH_ACTIVE" | "CONTROL_CLOSED";
  productionAdmissionAllowed: false;
  dispatchMutationPerformed: false;
}>;

export type Gate15LocalDecisionReason =
  | "OFFER_CONTRACT_TESTS_FAILED"
  | "COHORT_BUDGET_TESTS_FAILED"
  | "RISK_MODEL_TESTS_FAILED"
  | "PILOT_CONTROL_TESTS_FAILED"
  | "TRUTHFUL_OFFER_EVIDENCE_INCOMPLETE"
  | "HIDDEN_CAP_DETECTED"
  | "HIDDEN_MODEL_SUBSTITUTION_DETECTED"
  | "RESTRICTED_ROUTE_BREACH"
  | "COHORT_BUDGET_RECONCILIATION_FAILED"
  | "CUSTOMER_CREDIT_CHARGE_DETECTED"
  | "RISK_EVIDENCE_INCOMPLETE"
  | "SHOCK_HEAVY_USER_EVIDENCE_INCOMPLETE"
  | "AVERAGE_ONLY_DECISION_DETECTED"
  | "COHORT_LOSS_BUDGET_BREACH"
  | "LEGAL_FINANCE_CONTROL_EVIDENCE_INCOMPLETE"
  | "SALES_STOP_DRILL_NOT_PASSED"
  | "KILL_SWITCH_DRILL_NOT_PASSED"
  | "KILLED_POLICY_REOPENED"
  | "LOCAL_EXTERNAL_DISPATCH_DETECTED"
  | "LOCAL_PRODUCTION_ACTIVATION_DETECTED";

export type Gate15FormalBlocker =
  | "FORMAL_GATE_14_NOT_PASSED"
  | "REPRESENTATIVE_60_DAY_OR_TWO_CYCLE_DATA_MISSING"
  | "PUBLISHED_FAIR_USE_LEGAL_APPROVAL_MISSING"
  | "COHORT_BUDGET_FINANCE_APPROVAL_MISSING"
  | "REAL_COHORT_LOSS_EVIDENCE_NOT_WITHIN_BUDGET"
  | "REAL_SALES_STOP_KILL_SWITCH_DRILL_NOT_PASSED"
  | "NAMED_LEGAL_FINANCE_APPROVALS_MISSING";

export type Gate15LocalEvidence = Readonly<{
  evidenceId: string;
  offerContractTestsPassed: boolean;
  cohortBudgetTestsPassed: boolean;
  riskModelTestsPassed: boolean;
  pilotControlTestsPassed: boolean;
  offerPolicyCount: number;
  truthfulOfferDisclosureCount: number;
  hiddenCapViolationCount: number;
  hiddenModelSubstitutionViolationCount: number;
  restrictedRouteViolationCount: number;
  allowedCohortCogsMicrousd: string;
  availableCohortCogsMicrousd: string;
  reservedCohortCogsMicrousd: string;
  settledCohortCogsMicrousd: string;
  cohortBudgetLedgerChainVerified: boolean;
  cohortBudgetProjectionReconciled: boolean;
  customerCreditsChargedMicrousd: string;
  riskReportCount: number;
  representativeRiskReportCount: number;
  percentileReportCount: number;
  priceShockScenarioCount: number;
  heavyUserScenarioCount: number;
  averageOnlyDecisionCount: number;
  budgetBreachScenarioCount: number;
  maximumProjectedCohortLossMicrousd: string;
  approvedCohortLossBudgetMicrousd: string;
  pilotControlPolicyCount: number;
  localLegalApprovalCount: number;
  localFinanceApprovalCount: number;
  salesStopDrillPassed: boolean;
  killSwitchDrillPassed: boolean;
  killedPolicyReopenCount: number;
  externalDispatchCount: number;
  productionActivationCount: number;
  observedAt: string;
}>;

export type Gate15FormalDependencies = Readonly<{
  formalGate14Passed: boolean;
  representativeSixtyDayOrTwoCycleDataAvailable: boolean;
  publishedFairUseLegallyApproved: boolean;
  cohortBudgetFinanceApproved: boolean;
  realCohortLossWithinApprovedBudget: boolean;
  realSalesStopKillSwitchDrillPassed: boolean;
  namedLegalFinanceApprovals: boolean;
}>;

export type Gate15Decision = Readonly<{
  gate: 15;
  evaluatedAt: string;
  evidenceHash: string;
  decisionHash: string;
  localImplementationDecision: "PASS" | "HOLD";
  formalGateDecision: "PASS" | "HOLD";
  localReasons: readonly Gate15LocalDecisionReason[];
  formalBlockers: readonly Gate15FormalBlocker[];
  productionAuthorizationGranted: boolean;
  unlimitedRelaxedPilotActivationAuthorized: boolean;
}>;
