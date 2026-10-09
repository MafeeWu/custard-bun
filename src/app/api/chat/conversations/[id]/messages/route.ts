import { z } from "zod";
import { requireSession } from "@/server/auth/require-session";
import { ChatDomainError } from "@/server/chat/chat-errors";
import {
  createFailedChatStreamEvent,
  type ChatStreamEvent,
} from "@/server/chat/chat-events";
import { getGenerationService } from "@/server/chat/generation-service";
import { getRuntimeConfig } from "@/server/config/load-config";
import {
  chatErrorResponse,
  validationErrorResponse,
} from "../../../route-utils";

const routeParamsSchema = z.object({ id: z.uuid() }).strict();

function requestBodySchema(maxInputCharacters: number) {
  const clientRequestId = z.uuid();
  return z.union([
    z
      .object({
        clientRequestId,
        content: z.string().trim().min(1).max(maxInputCharacters),
      })
      .strict(),
    z
      .object({
        clientRequestId,
        retryAttemptId: z.uuid(),
      })
      .strict(),
  ]);
}

function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: ChatStreamEvent,
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function ndjsonResponse(
  generator: AsyncGenerator<ChatStreamEvent, void>,
  first: IteratorResult<ChatStreamEvent, void>,
): Response {
  const encoder = new TextEncoder();
  let pending = first;
  let attemptId =
    !first.done && "attemptId" in first.value
      ? first.value.attemptId
      : undefined;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!pending.done) {
          enqueueEvent(controller, encoder, pending.value);
          attemptId = pending.value.attemptId;
        }
        pending = await generator.next();
        if (pending.done) {
          controller.close();
        }
      } catch {
        if (attemptId) {
          enqueueEvent(
            controller,
            encoder,
            createFailedChatStreamEvent(
              attemptId,
              new ChatDomainError(
                "CHAT_INTERNAL",
                "Streaming response failed.",
              ),
            ),
          );
        }
        controller.close();
      }
    },
    async cancel() {
      await generator.return();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession(request.headers);
  const params = routeParamsSchema.safeParse(await context.params);
  if (!params.success) {
    return validationErrorResponse();
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    return validationErrorResponse();
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationErrorResponse();
  }
  const config = await getRuntimeConfig();
  const body = requestBodySchema(
    config.public.chat.maxInputCharacters,
  ).safeParse(rawBody);
  if (!body.success) {
    return validationErrorResponse();
  }

  try {
    const service = await getGenerationService();
    const generator =
      "content" in body.data
        ? service.startNewMessage({
            userId: session.user.id,
            conversationId: params.data.id,
            clientRequestId: body.data.clientRequestId,
            content: body.data.content,
            signal: request.signal,
          })
        : service.retry({
            userId: session.user.id,
            conversationId: params.data.id,
            clientRequestId: body.data.clientRequestId,
            attemptId: body.data.retryAttemptId,
            signal: request.signal,
          });
    const first = await generator.next();
    return ndjsonResponse(generator, first);
  } catch (error) {
    return chatErrorResponse(error);
  }
}
