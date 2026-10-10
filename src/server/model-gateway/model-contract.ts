import type { GatewayMessage } from "@/server/chat/prompt-assembler";

export type GatewayStreamEvent =
  | { type: "provider-call"; callNumber: number }
  | { type: "request-id"; requestId: string }
  | { type: "delta"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      estimated: false;
    };

export interface ModelGatewayStreamInput {
  messages: GatewayMessage[];
  modelId: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  firstTokenTimeoutMs: number;
  requestTimeoutMs: number;
  signal: AbortSignal;
}

export interface StructuredCompletionInput {
  messages: GatewayMessage[];
  maxOutputTokens: number;
  jsonSchema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface StructuredCompletionResult {
  content: string;
  modelId: string;
  providerRequestIds: string[];
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export interface ModelGateway {
  stream(
    input: ModelGatewayStreamInput,
  ): AsyncGenerator<GatewayStreamEvent, void>;
  completeStructured(
    input: StructuredCompletionInput,
  ): Promise<StructuredCompletionResult>;
}
