import { describe, expect, it } from "vitest";
import { createEmptyStandardProjection } from "./standard-projection-contract";
import { clearOfflineStandardDraft, loadOfflineStandardDraft, offlineStandardDraftKey, saveOfflineStandardDraft } from "./offline-standard-draft";

describe("offline Standard draft", () => {
  it("stores presentation drafts separately from canonical project data", () => {
    const projection = createEmptyStandardProjection(new Date("2026-08-24T12:00:00.000Z"));
    saveOfflineStandardDraft({ schemaVersion: 1, projectId: "project-1", baseProjectVersion: 7, projection, savedAt: "2026-08-24T12:00:00.000Z" });
    expect(loadOfflineStandardDraft("project-1")).toMatchObject({ baseProjectVersion: 7, projection: { schemaVersion: 1 } });
    expect(localStorage.getItem(offlineStandardDraftKey("project-1"))).not.toContain("assets");
    expect(localStorage.getItem(offlineStandardDraftKey("project-1"))).not.toContain("operations");
    expect(localStorage.getItem(offlineStandardDraftKey("project-1"))).not.toContain("bindings");
    clearOfflineStandardDraft("project-1");
    expect(loadOfflineStandardDraft("project-1")).toBeNull();
  });

  it("fails closed for a malformed or cross-project draft", () => {
    localStorage.setItem(offlineStandardDraftKey("project-2"), JSON.stringify({ schemaVersion: 1, projectId: "project-3" }));
    expect(loadOfflineStandardDraft("project-2")).toBeNull();
  });
});
