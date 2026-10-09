import { ChatDomainError, type ChatErrorCode } from "@/server/chat/chat-errors";

const statuses: Record<ChatErrorCode, number> = {
  CHAT_VALIDATION: 400,
  CHAT_NOT_FOUND: 404,
  CHAT_READ_ONLY: 409,
  CHAT_GENERATION_IN_PROGRESS: 409,
  CHAT_USER_REQUEST_QUOTA: 429,
  CHAT_USER_TOKEN_QUOTA: 429,
  CHAT_INSTANCE_REQUEST_BUDGET: 429,
  CHAT_INSTANCE_TOKEN_BUDGET: 429,
  CHAT_INSTANCE_CONCURRENCY: 429,
  CHAT_PROVIDER_AUTH: 502,
  CHAT_PROVIDER_RATE_LIMIT: 503,
  CHAT_PROVIDER_TIMEOUT: 504,
  CHAT_PROVIDER_PROTOCOL: 502,
  CHAT_STREAM_INTERRUPTED: 502,
  CHAT_INTERNAL: 500,
};

export function chatErrorResponse(error: unknown): Response {
  const domainError =
    error instanceof ChatDomainError
      ? error
      : new ChatDomainError("CHAT_INTERNAL", "Unexpected route failure.");
  return Response.json(
    { error: domainError.toPublicError() },
    { status: statuses[domainError.code] },
  );
}

export function validationErrorResponse(): Response {
  return chatErrorResponse(
    new ChatDomainError("CHAT_VALIDATION", "Invalid chat request."),
  );
}
