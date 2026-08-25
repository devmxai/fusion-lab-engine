import { describe, expect, it } from "vitest";
import { addLocalAsset, createCreativeSpaceProject, setSpaceViewMode } from "./domain";
import { evaluateGate17 } from "./gate17-evaluator";
import { projectToProfessionalGraph } from "./professional-graph";

const now = new Date("2026-08-19T12:00:00.000Z");

function validEvidence() {
  let standard = createCreativeSpaceProject("gate17-evidence", now);
  standard = addLocalAsset(standard, { name: "source.png", mimeType: "image/png", bytes: 10, position: { x: 0, y: 0 } }, now);
  const professional = setSpaceViewMode(standard, "PROFESSIONAL", now);
  const restoredStandard = setSpaceViewMode(professional, "STANDARD", now);
  return {
    standardProject: standard,
    professionalProject: professional,
    restoredStandardProject: restoredStandard,
    professionalProjection: projectToProfessionalGraph(professional),
    projectionMilliseconds: 1,
    observedAt: now.toISOString(),
  };
}

describe("Gate 17 local evaluator", () => {
  it("passes complete local proof but permanently holds formal/Production authority", async () => {
    const decision = await evaluateGate17({ local: validEvidence(), now });
    expect(decision).toMatchObject({
      gate: 17, localDecision: "PASS", formalGate: "HOLD", productionAuthorization: "DENIED",
      localReasons: [], formalBlockers: ["FORMAL_GA_EVIDENCE_MISSING"],
    });
    expect(decision.evidenceDigest).toHaveLength(64);
    expect(decision.decisionHash).toHaveLength(64);
  });

  it("holds on conversion, projection or budget evidence mismatch", async () => {
    const evidence = validEvidence();
    const decision = await evaluateGate17({ local: {
      ...evidence,
      restoredStandardProject: { ...evidence.restoredStandardProject, title: "changed" },
      professionalProjection: { ...evidence.professionalProjection, nodes: [] },
      projectionMilliseconds: 151,
    }, now });
    expect(decision.localReasons).toEqual(expect.arrayContaining([
      "STANDARD_PROFESSIONAL_DATA_MISMATCH", "SEMANTIC_PROJECTION_MISMATCH", "PROFESSIONAL_BUDGET_HOLD",
    ]));
  });

  it("rejects invalid evaluation timestamps", async () => {
    const evidence = validEvidence();
    await expect(evaluateGate17({ local: { ...evidence, observedAt: "invalid" }, now }))
      .rejects.toThrow("Gate 17 evidence timestamps must be valid.");
  });
});
