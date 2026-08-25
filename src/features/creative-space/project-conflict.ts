import type { CreativeSpaceProject } from "./domain";

export type ProjectConflictArea = "TITLE" | "ASSETS" | "OPERATIONS" | "BINDINGS" | "STANDARD_PROJECTION" | "SPACE_PROJECTION";

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function projectConflictAreas(local: CreativeSpaceProject, remote: CreativeSpaceProject): ProjectConflictArea[] {
  const areas: ProjectConflictArea[] = [];
  if (local.title !== remote.title) areas.push("TITLE");
  if (!same(local.assets, remote.assets)) areas.push("ASSETS");
  if (!same(local.operations, remote.operations)) areas.push("OPERATIONS");
  if (!same(local.bindings, remote.bindings)) areas.push("BINDINGS");
  if (!same(local.standardProjection, remote.standardProjection)) areas.push("STANDARD_PROJECTION");
  if (!same(local.professionalGraph, remote.professionalGraph)) areas.push("SPACE_PROJECTION");
  return areas;
}
