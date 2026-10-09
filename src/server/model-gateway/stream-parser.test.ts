import { ModelGatewayError } from "./model-error";
import { parseOpenAiStream } from "./stream-parser";

const encoder = new TextEncoder();

async function* chunksFrom(parts: Uint8Array[]) {
  for (const part of parts) {
    yield part;
  }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) {
    values.push(value);
  }
  return values;
}

function expectProtocolError(error: unknown): boolean {
  expect(error).toBeInstanceOf(ModelGatewayError);
  expect(error).toMatchObject({
    category: "protocol",
    retryable: false,
  });
  return true;
}

describe("parseOpenAiStream", () => {
  test.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("parses %s event separators", async (_name, separator) => {
    const source = chunksFrom([
      encoder.encode(
        `data: {"choices":[{"delta":{"content":"hello"}}]}${separator}${separator}` +
          `data: [DONE]${separator}${separator}`,
      ),
    ]);

    await expect(collect(parseOpenAiStream(source))).resolves.toEqual([
      { type: "delta", text: "hello" },
    ]);
  });

  test("parses fragmented UTF-8 bytes, multiple frames, comments, blank lines, usage, and DONE", async () => {
    const payload = [
      ": provider keep-alive\r\n\r\n",
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      "\n",
      "data: [DONE]\n\n",
    ].join("");
    const bytes = encoder.encode(payload);
    const firstCharacter = encoder.encode("你");
    const characterStart = payload.indexOf("你");
    const prefixBytes = encoder.encode(payload.slice(0, characterStart)).length;
    const splitInsideCharacter = prefixBytes + firstCharacter.length - 1;

    await expect(
      collect(
        parseOpenAiStream(
          chunksFrom([
            bytes.slice(0, splitInsideCharacter),
            bytes.slice(splitInsideCharacter, splitInsideCharacter + 7),
            bytes.slice(splitInsideCharacter + 7),
          ]),
        ),
      ),
    ).resolves.toEqual([
      { type: "delta", text: "你" },
      { type: "delta", text: "好" },
      {
        type: "usage",
        inputTokens: 10,
        outputTokens: 2,
        estimated: false,
      },
    ]);
  });

  test("rejects malformed JSON without retaining the provider frame", async () => {
    const source = chunksFrom([
      encoder.encode('data: {"choices":[}\n\ndata: [DONE]\n\n'),
    ]);

    await expect(collect(parseOpenAiStream(source))).rejects.toSatisfy(
      (error: unknown) => {
        expectProtocolError(error);
        expect(String(error)).not.toContain('{"choices":[}');
        return true;
      },
    );
  });

  test("rejects payloads with no choices field", async () => {
    const source = chunksFrom([
      encoder.encode('data: {"id":"provider-secret"}\n\ndata: [DONE]\n\n'),
    ]);

    await expect(collect(parseOpenAiStream(source))).rejects.toSatisfy(
      expectProtocolError,
    );
  });

  test("rejects EOF before the DONE sentinel", async () => {
    const source = chunksFrom([
      encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    ]);

    await expect(collect(parseOpenAiStream(source))).rejects.toSatisfy(
      expectProtocolError,
    );
  });

  test("does not dispatch an unterminated data event at EOF", async () => {
    const iterator = parseOpenAiStream(
      chunksFrom([
        encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}'),
      ]),
    );

    await expect(iterator.next()).rejects.toSatisfy(expectProtocolError);
  });

  test("does not accept an unterminated DONE event at EOF", async () => {
    const iterator = parseOpenAiStream(
      chunksFrom([encoder.encode("data: [DONE]")]),
    );

    await expect(iterator.next()).rejects.toSatisfy(expectProtocolError);
  });
});
