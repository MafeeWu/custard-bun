import { getAuth } from "@/server/auth/auth";
import { getDatabase } from "@/server/db/database";
import { downloadDataExport } from "@/server/privacy/data-export-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const notFound = () =>
  new Response("Not found.", { status: 404, headers: privateHeaders });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return notFound();
    const session = await (
      await getAuth()
    ).api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    if (
      !session ||
      session.user.banned ||
      ("deletionPendingAt" in session.user && session.user.deletionPendingAt)
    )
      return notFound();
    const archive = await downloadDataExport(await getDatabase(), {
      userId: session.user.id,
      exportId: id,
      now: new Date(),
    });
    if (!archive) return notFound();
    return new Response(new Uint8Array(archive.bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="custard-bun-export-${id}.zip"`,
        "Content-Length": String(archive.size),
      },
    });
  } catch {
    return notFound();
  }
}
