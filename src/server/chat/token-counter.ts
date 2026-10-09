import "server-only";

import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

const MESSAGE_OVERHEAD_TOKENS = 4;
const REPLY_PRIMER_TOKENS = 2;
const SAFETY_MARGIN_MULTIPLIER = 1.2;
const ALLOWED_SPECIAL_TOKENS: string[] = [];
const DISALLOWED_SPECIAL_TOKENS: string[] = [];

export interface TokenCounterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenCounter {
  estimateText(value: string): number;
  estimateMessages(messages: TokenCounterMessage[]): number;
  withSafetyMargin(tokens: number): number;
  free(): void;
}

function requireEncoding(encoding: Tiktoken | undefined): Tiktoken {
  if (!encoding) {
    throw new Error("TokenCounter has been released");
  }

  return encoding;
}

function countTokens(encoding: Tiktoken, value: string): number {
  return encoding.encode(
    value,
    ALLOWED_SPECIAL_TOKENS,
    DISALLOWED_SPECIAL_TOKENS,
  ).length;
}

export function createTokenCounter(_modelId: string): TokenCounter {
  let encoding: Tiktoken | undefined = new Tiktoken(cl100k_base);

  return {
    estimateText(value: string): number {
      if (value.length === 0) {
        return 0;
      }

      return countTokens(requireEncoding(encoding), value);
    },
    estimateMessages(messages: TokenCounterMessage[]): number {
      const encoder = requireEncoding(encoding);

      const contentTokens = messages.reduce((total, message) => {
        void message.role;
        return total + countTokens(encoder, message.content);
      }, 0);

      return (
        contentTokens +
        messages.length * MESSAGE_OVERHEAD_TOKENS +
        REPLY_PRIMER_TOKENS
      );
    },
    withSafetyMargin(tokens: number): number {
      if (tokens <= 0) {
        return 0;
      }

      return Math.ceil(tokens * SAFETY_MARGIN_MULTIPLIER);
    },
    free(): void {
      encoding = undefined;
    },
  };
}
