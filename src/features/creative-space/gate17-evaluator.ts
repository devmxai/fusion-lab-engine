import { getSpaceViewMode, type CreativeSpaceProject } from "./domain";
import { assessProfessionalGraphBudget, projectToProfessionalGraph, type ProfessionalGraphBudgetAssessment, type ProfessionalGraphProjection } from "./professional-graph";

export type Gate17LocalReason =
  | "INVALID_VIEW_MODE_SEQUENCE"
  | "STANDARD_PROFESSIONAL_DATA_MISMATCH"
  | "SEMANTIC_PROJECTION_MISMATCH"
  | "PROFESSIONAL_BUDGET_HOLD";

export type Gate17Decision = Readonly<{
  gate: 17;
  evaluatedAt: string;
  localDecision: "PASS" | "HOLD";
  formalGate: "HOLD";
  productionAuthorization: "DENIED";
  localReasons: readonly Gate17LocalReason[];
  formalBlockers: readonly ["FORMAL_GA_EVIDENCE_MISSING"];
  evidenceDigest: string;
  decisionHash: string;
}>;

export type Gate17LocalEvidence = Readonly<{
  standardProject: CreativeSpaceProject;
  professionalProject: CreativeSpaceProject;
  restoredStandardProject: CreativeSpaceProject;
  professionalProjection: ProfessionalGraphProjection;
  projectionMilliseconds: number;
  observedAt: string;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalDomain(project: CreativeSpaceProject) {
  return {
    projectId: project.projectId,
    title: project.title,
    assets: project.assets,
    operations: project.operations,
    bindings: project.bindings,
    canvasItems: project.canvasItems,
    viewport: project.viewport,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/** Local-only Gate 17 evaluator. It has no path to formal or Production authorization. */
export async function evaluateGate17(input: { local: Gate17LocalEvidence; now?: Date }): Promise<Gate17Decision> {
  const evaluatedAt = input.now ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime()) || Number.isNaN(Date.parse(input.local.observedAt))) {
    throw new TypeError("Gate 17 evidence timestamps must be valid.");
  }
  const localReasons: Gate17LocalReason[] = [];
  const evidence = input.local;
  if (getSpaceViewMode(evidence.standardProject) !== "STANDARD"
    || getSpaceViewMode(evidence.professionalProject) !== "PROFESSIONAL"
    || getSpaceViewMode(evidence.restoredStandardProject) !== "STANDARD") {
    localReasons.push("INVALID_VIEW_MODE_SEQUENCE");
  }
  if (!sameValue(canonicalDomain(evidence.standardProject), canonicalDomain(evidence.professionalProject))
    || !sameValue(canonicalDomain(evidence.standardProject), canonicalDomain(evidence.restoredStandardProject))) {
    localReasons.push("STANDARD_PROFESSIONAL_DATA_MISMATCH");
  }
  const expectedProjection = projectToProfessionalGraph(evidence.professionalProject);
  if (!sameValue(expectedProjection, evidence.professionalProjection)) localReasons.push("SEMANTIC_PROJECTION_MISMATCH");
  const budget: ProfessionalGraphBudgetAssessment = assessProfessionalGraphBudget(expectedProjection, {
    timelineClipCount: Object.keys(evidence.professionalProject.professionalGraph?.timelineClips ?? {}).length,
    projectionMilliseconds: evidence.projectionMilliseconds,
  });
  if (!budget.withinBudget) localReasons.push("PROFESSIONAL_BUDGET_HOLD");
  const evidenceDigest = await sha256(evidence);
  const decisionBase = {
    gate: 17 as const,
    evaluatedAt: evaluatedAt.toISOString(),
    localDecision: localReasons.length === 0 ? "PASS" as const : "HOLD" as const,
    formalGate: "HOLD" as const,
    productionAuthorization: "DENIED" as const,
    localReasons,
    formalBlockers: ["FORMAL_GA_EVIDENCE_MISSING"] as const,
    evidenceDigest,
  };
  return { ...decisionBase, decisionHash: await sha256(decisionBase) };
}
