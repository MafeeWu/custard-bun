import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

async function handlers() {
  return toNextJsHandler(await getAuth());
}

export async function GET(request: Request): Promise<Response> {
  return (await handlers()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await handlers()).POST(request);
}
