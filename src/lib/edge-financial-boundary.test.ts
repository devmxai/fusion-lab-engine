import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("legacy Edge financial boundary", () => {
  it("holds an ambiguous provider submit instead of automatically releasing its reservation", () => {
    const content = source("supabase/functions/start-generation/index.ts");
    const unknownBranchStart = content.indexOf('if (submissionTransportDisposition(providerDispatchAttempted) === "HOLD_FOR_RECONCILIATION")');
    const unknownBranchEnd = content.indexOf("\n      }\n\n      try {", unknownBranchStart);
    const unknownBranch = content.slice(unknownBranchStart, unknownBranchEnd);

    expect(content).toContain('import { submissionTransportDisposition }');
    expect(unknownBranch).toContain('markSubmissionUnknown("provider_transport_or_response_failure")');
    expect(unknownBranch).toContain('error: "submission_unknown"');
    expect(unknownBranch).not.toContain('release_credits');
  });

  it("records a durable generation result before settlement and rejects text-only refund evidence", () => {
    const content = source("supabase/functions/complete-generation/index.ts");
    const insertPosition = content.indexOf('.from("generations")\n          .insert(');
    const settlePosition = content.indexOf('rpc("settle_credits"');

    expect(content).toContain('hasConfirmedTerminalNoChargeEvidence');
    expect(content).not.toContain('CONFIRMED_REFUND_FAILURE_PATTERNS');
    expect(insertPosition).toBeGreaterThan(-1);
    expect(settlePosition).toBeGreaterThan(insertPosition);
    expect(content).toContain('error: "durable_delivery_record_failed"');
  });

  it("preserves KIE native usage for later route-specific reconciliation", () => {
    const content = source("supabase/functions/kie-ai/index.ts");

    expect(content).toContain("function extractProviderUsage");
    expect(content).toContain("taskData?.creditsConsumed");
    expect(content).toContain("taskData?.credits_consumed");
    expect(content).toContain("result.creditsConsumed = providerUsage");
  });
});
