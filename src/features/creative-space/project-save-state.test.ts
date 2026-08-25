import { describe, expect, it } from "vitest";
import { PROJECT_SAVE_LABELS, reduceProjectSaveState } from "./project-save-state";

describe("project autosave state", () => {
  it("represents loading, dirty, saving and saved explicitly", () => {
    expect(reduceProjectSaveState("SAVED", { type: "LOAD_STARTED" })).toBe("LOADING");
    expect(reduceProjectSaveState("LOADING", { type: "LOAD_SUCCEEDED" })).toBe("SAVED");
    expect(reduceProjectSaveState("SAVED", { type: "LOCAL_CHANGE", online: true })).toBe("DIRTY");
    expect(reduceProjectSaveState("DIRTY", { type: "SAVE_STARTED" })).toBe("SAVING");
    expect(reduceProjectSaveState("SAVING", { type: "SAVE_SUCCEEDED" })).toBe("SAVED");
  });

  it("never hides offline, version conflict or secondary-tab states", () => {
    expect(reduceProjectSaveState("DIRTY", { type: "NETWORK_OFFLINE" })).toBe("OFFLINE");
    expect(reduceProjectSaveState("SAVING", { type: "VERSION_CONFLICT" })).toBe("CONFLICT");
    expect(reduceProjectSaveState("SAVED", { type: "SECONDARY_TAB" })).toBe("READ_ONLY");
    expect(PROJECT_SAVE_LABELS.ar.CONFLICT).toBe("تعارض");
  });
});
