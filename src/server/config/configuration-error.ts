import { safeErrorName } from "../logging/safe-error";

export class ConfigurationError extends Error {}

export function startupDiagnostic(error: unknown): string {
  return error instanceof ConfigurationError
    ? error.message
    : `startup dependency failed (${safeErrorName(error)})`;
}
