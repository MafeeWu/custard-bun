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

export interface ModelGateway {
  stream(
    input: ModelGatewayStreamInput,
  ): AsyncGenerator<GatewayStreamEvent, void>;
}
