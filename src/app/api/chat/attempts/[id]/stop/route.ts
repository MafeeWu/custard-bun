import { z } from "zod";
import { requireSession } from "@/server/auth/require-session";
import { getGenerationService } from "@/server/chat/generation-service";
import {
  chatErrorResponse,
  validationErrorResponse,
} from "../../../route-utils";

const routeParamsSchema = z.object({ id: z.uuid() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession(request.headers);
  const params = routeParamsSchema.safeParse(await context.params);
  if (!params.success) {
    return validationErrorResponse();
  }

  try {
    const service = await getGenerationService();
    await service.stop({
      userId: session.user.id,
      attemptId: params.data.id,
    });
    return new Response(null, { status: 202 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
