import { describe, expect, it } from "vitest";
import { createCreativeSpaceProject } from "./domain";
import { projectConflictAreas } from "./project-conflict";
import { createEmptyStandardProjection } from "./standard-projection-contract";

describe("project conflict summary", () => {
  it("reports understandable domain areas without merging canonical records", () => {
    const base = createCreativeSpaceProject("conflict", new Date("2026-08-24T00:00:00.000Z"));
    const local = { ...base, title: "Local title", standardProjection: createEmptyStandardProjection(new Date("2026-08-24T01:00:00.000Z")) };
    const remote = { ...base, title: "Remote title" };
    expect(projectConflictAreas(local, remote)).toEqual(["TITLE", "STANDARD_PROJECTION"]);
  });
});
