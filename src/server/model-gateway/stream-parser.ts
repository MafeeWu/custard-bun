import type { GatewayStreamEvent } from "./model-contract";
import { ModelGatewayError } from "./model-error";

type ParsedStreamEvent = Extract<
  GatewayStreamEvent,
  { type: "delta" | "usage" }
>;

function protocolError(): ModelGatewayError {
  return new ModelGatewayError("protocol");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseUsage(value: unknown): ParsedStreamEvent | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw protocolError();
  }

  const inputTokens = value.prompt_tokens;
  const outputTokens = value.completion_tokens;
  if (
    !Number.isInteger(inputTokens) ||
    (inputTokens as number) < 0 ||
    !Number.isInteger(outputTokens) ||
    (outputTokens as number) < 0
  ) {
    throw protocolError();
  }

  return {
    type: "usage",
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    estimated: false,
  };
}

function parseFrame(data: string): ParsedStreamEvent[] {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw protocolError();
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw protocolError();
  }

  const events: ParsedStreamEvent[] = [];
  for (const choice of payload.choices) {
    if (!isRecord(choice)) {
      throw protocolError();
    }
    const delta = choice.delta;
    if (delta === undefined || delta === null) {
      continue;
    }
    if (!isRecord(delta)) {
      throw protocolError();
    }
    const content = delta.content;
    if (content === undefined || content === null || content === "") {
      continue;
    }
    if (typeof content !== "string") {
      throw protocolError();
    }
    events.push({ type: "delta", text: content });
  }

  const usage = parseUsage(payload.usage);
  if (usage) {
    events.push(usage);
  }
  return events;
}

export async function* parseOpenAiStream(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<ParsedStreamEvent, void> {
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let dataLines: string[] = [];
  let completed = false;

  const processLine = (line: string): ParsedStreamEvent[] | "done" => {
    const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (normalizedLine === "") {
      if (dataLines.length === 0) {
        return [];
      }
      const data = dataLines.join("\n");
      dataLines = [];
      if (data.trim() === "[DONE]") {
        return "done";
      }
      return parseFrame(data);
    }
    if (normalizedLine.startsWith(":")) {
      return [];
    }

    const separator = normalizedLine.indexOf(":");
    const field =
      separator === -1 ? normalizedLine : normalizedLine.slice(0, separator);
    if (field !== "data") {
      return [];
    }
    let value = separator === -1 ? "" : normalizedLine.slice(separator + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    dataLines.push(value);
    return [];
  };

  const processText = function* (
    text: string,
    endOfStream = false,
  ): Generator<ParsedStreamEvent> {
    lineBuffer += text;
    while (true) {
      const separatorIndex = lineBuffer.search(/[\r\n]/);
      if (separatorIndex === -1) {
        return;
      }
      const separator = lineBuffer[separatorIndex];
      if (
        separator === "\r" &&
        separatorIndex === lineBuffer.length - 1 &&
        !endOfStream
      ) {
        return;
      }
      const separatorLength =
        separator === "\r" && lineBuffer[separatorIndex + 1] === "\n" ? 2 : 1;
      const line = lineBuffer.slice(0, separatorIndex);
      lineBuffer = lineBuffer.slice(separatorIndex + separatorLength);
      const result = processLine(line);
      if (result === "done") {
        completed = true;
        return;
      }
      yield* result;
    }
  };

  for await (const chunk of chunks) {
    if (completed) {
      break;
    }
    yield* processText(decoder.decode(chunk, { stream: true }));
  }

  if (!completed) {
    yield* processText(decoder.decode(), true);
  }
  if (!completed) {
    throw protocolError();
  }
}
