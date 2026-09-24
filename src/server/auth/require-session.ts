import "server-only";

import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function requireSession(requestHeaders: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session) {
    redirect("/auth/sign-in");
  }

  return session;
}
