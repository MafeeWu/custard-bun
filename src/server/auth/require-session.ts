import "server-only";

import { redirect } from "next/navigation";
import { getAuth } from "./auth";

export async function requireSession(requestHeaders: Headers) {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session) {
    redirect("/auth/sign-in");
  }

  return session;
}
