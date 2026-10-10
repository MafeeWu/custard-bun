export type MemoryErrorCode =
  | "MEMORY_VALIDATION"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_REVISION_CONFLICT"
  | "MEMORY_INTERNAL";

export type MemoryErrorMetadataValue = string | number | boolean | null;
export type MemoryErrorMetadata = Record<string, MemoryErrorMetadataValue>;

export interface PublicMemoryError {
  code: MemoryErrorCode;
  message: string;
  retryable: boolean;
  metadata?: MemoryErrorMetadata;
}

const publicMessages: Record<MemoryErrorCode, string> = {
  MEMORY_VALIDATION: "The memory change is invalid.",
  MEMORY_NOT_FOUND: "The requested memory was not found.",
  MEMORY_REVISION_CONFLICT: "Memory changed since it was loaded.",
  MEMORY_INTERNAL: "Something went wrong while changing memory.",
};

const blockedMetadataFragments = [
  "archive",
  "authorization",
  "content",
  "cookie",
  "credential",
  "email",
  "message",
  "password",
  "prompt",
  "secret",
  "summary",
  "token",
] as const;

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): MemoryErrorMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const safe: MemoryErrorMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      blockedMetadataFragments.some((fragment) =>
        normalizedKey.includes(fragment),
      )
    ) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      safe[key] = value;
    }
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

export class MemoryDomainError extends Error {
  public readonly publicMessage: string;
  public readonly retryable: boolean;
  public readonly metadata?: MemoryErrorMetadata;

  constructor(
    public readonly code: MemoryErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.publicMessage = publicMessages[code];
    this.retryable = options.retryable ?? false;
    this.metadata = sanitizeMetadata(options.metadata);
  }

  toPublicError(): PublicMemoryError {
    return {
      code: this.code,
      message: this.publicMessage,
      retryable: this.retryable,
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }

  toJSON(): PublicMemoryError {
    return this.toPublicError();
  }
}
