type SafeLogValue = boolean | number | string | null;
type SafeLogContext = Record<string, SafeLogValue>;

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Edge logs are retained for operations, not for replaying user/provider data.
 * Context intentionally accepts only scalar fields; never pass payloads, URLs,
 * prompts, provider bodies, secrets, or exception messages here.
 */
export function logSafeEdgeEvent(event: string, context: SafeLogContext = {}): void {
  console.log(event, JSON.stringify(context));
}

export function logSafeEdgeError(event: string, error: unknown, context: SafeLogContext = {}): void {
  console.error(event, JSON.stringify({ ...context, error_type: errorType(error) }));
}
