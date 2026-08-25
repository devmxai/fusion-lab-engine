import type { CreativeSpaceProject, SpaceOperation } from "./domain";

const terminalStates = new Set(["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"]);
const reviewStates = new Set(["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"]);

/** Finds a durable unfinished image operation; it never creates or re-dispatches an operation. */
export function recoverableStandardImageOperation(project: CreativeSpaceProject): SpaceOperation | null {
  return Object.values(project.operations)
    .filter((operation) => operation.recipeId.startsWith("image.") && !terminalStates.has(operation.state))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function isTerminalStandardOperation(state: SpaceOperation["state"]): boolean {
  return terminalStates.has(state);
}

/** Makes a persisted terminal review state visible after refresh. This is
 * display-only; it never retries or dispatches an operation. */
export function latestStandardImageReviewOperation(project: CreativeSpaceProject): SpaceOperation | null {
  // A historical failure must not hide a newer successful image. Determine
  // the latest image operation first, then expose it only when that latest
  // operation genuinely still needs review.
  const latest = Object.values(project.operations)
    .filter((operation) => operation.recipeId.startsWith("image."))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  return latest && reviewStates.has(latest.state) ? latest : null;
}
