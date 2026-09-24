const safeNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "APIError",
  "PostgresError",
]);

export function safeErrorName(error: unknown): string {
  return error instanceof Error && safeNames.has(error.name)
    ? error.name
    : "UnknownError";
}

export interface SafeLogger {
  error(category: string, metadata: { name: string }): void;
}
