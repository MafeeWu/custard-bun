import type { ChatErrorCode } from "./chat-errors";

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
