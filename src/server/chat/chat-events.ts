import {
  type ChatDomainError,
  type ChatErrorCode,
  type PublicChatError,
} from "./chat-errors";

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface ChatStreamErrorFields {
  code: ChatErrorCode;
  message: string;
  retryable: boolean;
  resetAt?: string;
}

export type ChatStreamEvent =
  | { type: "started"; attemptId: string }
  | { type: "delta"; attemptId: string; text: string }
  | { type: "completed"; attemptId: string; usage: ChatUsage }
  | ({ type: "failed"; attemptId: string } & ChatStreamErrorFields)
  | ({ type: "interrupted"; attemptId: string } & ChatStreamErrorFields);

function toStreamErrorFields(error: ChatDomainError): ChatStreamErrorFields {
  const publicError: PublicChatError = error.toPublicError();

  return {
    code: publicError.code,
    message: publicError.message,
    retryable: publicError.retryable,
    ...(publicError.resetAt ? { resetAt: publicError.resetAt } : {}),
  };
}

export function createFailedChatStreamEvent(
  attemptId: string,
  error: ChatDomainError,
): Extract<ChatStreamEvent, { type: "failed" }> {
  return {
    type: "failed",
    attemptId,
    ...toStreamErrorFields(error),
  };
}

export function createInterruptedChatStreamEvent(
  attemptId: string,
  error: ChatDomainError,
): Extract<ChatStreamEvent, { type: "interrupted" }> {
  return {
    type: "interrupted",
    attemptId,
    ...toStreamErrorFields(error),
  };
}
