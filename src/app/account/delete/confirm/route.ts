import { randomBytes } from "node:crypto";
import { getDatabase } from "@/server/db/database";
import { confirmAccountDeletion } from "@/server/privacy/account-deletion-service";

export const runtime = "nodejs";
const safeHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
export async function GET() {
  const nonce = randomBytes(16).toString("base64");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Confirm account deletion</title></head>
<body><main><h1>Confirm account deletion</h1><p>Confirmation immediately signs you out and stops account access. Private data is then purged asynchronously. This cannot be undone.</p>
<form method="post"><input type="hidden" name="token" id="token"><button type="submit">Confirm account deletion</button></form>
<script nonce="${nonce}">document.getElementById("token").value=new URLSearchParams(location.hash.slice(1)).get("token")||"";history.replaceState(null,"",location.pathname);</script>
<noscript>Enable JavaScript to confirm your emailed deletion request.</noscript></main></body></html>`,
    {
      headers: {
        ...safeHeaders,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin)
      throw new Error("DELETION_UNAVAILABLE");
    if (Number(request.headers.get("content-length") ?? 0) > 4096)
      throw new Error("DELETION_UNAVAILABLE");
    const body = await request.text();
    if (body.length > 4096) throw new Error("DELETION_UNAVAILABLE");
    const token = new URLSearchParams(body).get("token") ?? "";
    await confirmAccountDeletion(await getDatabase(), {
      token,
      now: new Date(),
    });
  } catch {
    // Invalid, expired, duplicate and accepted confirmations are deliberately indistinguishable.
  }
  const headers = new Headers({
    ...safeHeaders,
    location: new URL("/goodbye", request.url).toString(),
  });
  for (const name of [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
  ]) {
    headers.append(
      "set-cookie",
      `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${name.startsWith("__Secure") ? "; Secure" : ""}`,
    );
  }
  return new Response(null, { status: 303, headers });
}
