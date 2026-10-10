import "server-only";

import { redirect } from "next/navigation";
import { getAuth } from "./auth";

export async function requireSession(requestHeaders: Headers) {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  });

  if (
    !session ||
    session.user.banned === true ||
    session.user.deletionPendingAt
  ) {
    redirect("/auth/sign-in");
  }

  return session;
}
