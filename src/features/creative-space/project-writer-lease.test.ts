import { describe, expect, it } from "vitest";
import { selectProjectWriter } from "./project-writer-lease";

describe("project writer election", () => {
  it("keeps the oldest browser tab as the only writer", () => {
    expect(selectProjectWriter([
      { tabId: "new", startedAt: 20 },
      { tabId: "old", startedAt: 10 },
    ])).toBe("old");
  });

  it("uses stable tab identity when tabs start together", () => {
    expect(selectProjectWriter([
      { tabId: "tab-b", startedAt: 10 },
      { tabId: "tab-a", startedAt: 10 },
    ])).toBe("tab-a");
  });

  it("returns null without candidates", () => {
    expect(selectProjectWriter([])).toBeNull();
  });
});
