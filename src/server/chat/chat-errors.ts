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

export interface PublicChatError {
  code: ChatErrorCode;
  message: string;
  retryable: boolean;
  resetAt?: string;
  metadata?: ChatErrorMetadata;
}

const blockedMetadataKeys = new Set(["body", "content", "message"]);
const blockedMetadataFragments = [
  "accesskey",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "message",
  "password",
  "privatekey",
  "prompt",
  "providerraw",
  "rawbody",
  "rawcontent",
  "requestbody",
  "requestcontent",
  "responsebody",
  "responsecontent",
  "secret",
  "secretkey",
  "token",
] as const;
const publicChatErrorMessages: Record<ChatErrorCode, string> = {
  CHAT_VALIDATION: "The chat request is invalid.",
  CHAT_NOT_FOUND: "The requested chat was not found.",
  CHAT_READ_ONLY: "This chat is read-only.",
  CHAT_GENERATION_IN_PROGRESS:
    "A response is already being generated for this chat.",
  CHAT_USER_REQUEST_QUOTA: "You have reached today's chat request limit.",
  CHAT_USER_TOKEN_QUOTA: "You have reached today's chat token limit.",
  CHAT_INSTANCE_REQUEST_BUDGET:
    "This deployment has reached its request budget.",
  CHAT_INSTANCE_TOKEN_BUDGET: "This deployment has reached its token budget.",
  CHAT_INSTANCE_CONCURRENCY:
    "This deployment is already generating the maximum number of responses.",
  CHAT_PROVIDER_AUTH: "The model provider rejected the request.",
  CHAT_PROVIDER_RATE_LIMIT: "The model provider is rate limiting requests.",
  CHAT_PROVIDER_TIMEOUT: "The model provider took too long to respond.",
  CHAT_PROVIDER_PROTOCOL: "The model provider returned an unexpected response.",
  CHAT_STREAM_INTERRUPTED: "The response stream ended before completion.",
  CHAT_INTERNAL: "Something went wrong while generating a response.",
};

function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isBlockedMetadataKey(key: string): boolean {
  const normalizedKey = normalizeMetadataKey(key);

  if (blockedMetadataKeys.has(normalizedKey)) {
    return true;
  }

  return blockedMetadataFragments.some((fragment) =>
    normalizedKey.includes(fragment),
  );
}

export function getPublicChatErrorMessage(code: ChatErrorCode): string {
  return publicChatErrorMessages[code];
}

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
    if (isBlockedMetadataKey(key)) {
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
  public readonly publicMessage: string;

  constructor(
    public readonly code: ChatErrorCode,
    message: string,
    options: ChatDomainErrorOptions = { retryable: false },
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.retryable = options.retryable;
    this.publicMessage = getPublicChatErrorMessage(code);
    this.resetAt =
      typeof options.resetAt === "string"
        ? options.resetAt
        : options.resetAt?.toISOString();
    this.metadata = sanitizeMetadata(options.metadata);
  }

  toPublicError(): PublicChatError {
    return {
      code: this.code,
      message: this.publicMessage,
      retryable: this.retryable,
      ...(this.resetAt ? { resetAt: this.resetAt } : {}),
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }

  toJSON(): PublicChatError {
    return this.toPublicError();
  }
}
