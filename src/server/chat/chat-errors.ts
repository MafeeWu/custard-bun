export type ChatErrorCode =
  | "CHAT_VALIDATION"
  | "CHAT_NOT_FOUND"
  | "CHAT_READ_ONLY"
  | "CHAT_GENERATION_IN_PROGRESS"
  | "CHAT_USER_REQUEST_QUOTA"
  | "CHAT_USER_TOKEN_QUOTA"
  | "CHAT_INSTANCE_REQUEST_BUDGET"
  | "CHAT_INSTANCE_TOKEN_BUDGET"
  | "CHAT_INSTANCE_CONCURRENCY"
  | "CHAT_PROVIDER_AUTH"
  | "CHAT_PROVIDER_RATE_LIMIT"
  | "CHAT_PROVIDER_TIMEOUT"
  | "CHAT_PROVIDER_PROTOCOL"
  | "CHAT_STREAM_INTERRUPTED"
  | "CHAT_INTERNAL";

export type ChatErrorMetadataValue = string | number | boolean | null;
export type ChatErrorMetadata = Record<string, ChatErrorMetadataValue>;

const blockedMetadataKeys = new Set([
  "authorization",
  "content",
  "cookie",
  "message",
  "password",
  "prompt",
  "secret",
  "token",
]);

function isChatErrorMetadataValue(
  value: unknown,
): value is ChatErrorMetadataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function sanitizeMetadata(metadata: unknown): ChatErrorMetadata | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const prototype = Object.getPrototypeOf(metadata);
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    return undefined;
  }

  const sanitized: ChatErrorMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blockedMetadataKeys.has(key.toLowerCase())) {
      continue;
    }
    if (!isChatErrorMetadataValue(value)) {
      continue;
    }
    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export interface ChatDomainErrorOptions {
  retryable: boolean;
  resetAt?: Date | string;
  metadata?: Record<string, unknown>;
}

export class ChatDomainError extends Error {
  public readonly retryable: boolean;
  public readonly resetAt?: string;
  public readonly metadata?: ChatErrorMetadata;

  constructor(
    public readonly code: ChatErrorCode,
    message: string,
    options: ChatDomainErrorOptions = { retryable: false },
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.retryable = options.retryable;
    this.resetAt =
      typeof options.resetAt === "string"
        ? options.resetAt
        : options.resetAt?.toISOString();
    this.metadata = sanitizeMetadata(options.metadata);
  }

  toJSON(): {
    code: ChatErrorCode;
    message: string;
    retryable: boolean;
    resetAt?: string;
    metadata?: ChatErrorMetadata;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.resetAt ? { resetAt: this.resetAt } : {}),
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }
}
