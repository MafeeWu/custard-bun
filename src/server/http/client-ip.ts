import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export function bindSocketIdentity(request: IncomingMessage): void {
  const address = request.socket.remoteAddress;
  if (!address || !isIP(address)) throw new Error("Missing socket identity");
  const untrustedIdentity =
    /^(?:forwarded|x-forwarded-.*|x-real-ip|cf-connecting-ip|true-client-ip|x-companion-client-ip)$/i;
  for (const name of Object.keys(request.headers)) {
    if (untrustedIdentity.test(name)) delete request.headers[name];
  }
  const rawHeaders: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (!untrustedIdentity.test(request.rawHeaders[i])) {
      rawHeaders.push(request.rawHeaders[i], request.rawHeaders[i + 1]);
    }
  }
  request.headers["x-companion-client-ip"] = address;
  request.headers["x-forwarded-for"] = address;
  request.rawHeaders = [
    ...rawHeaders,
    "x-companion-client-ip",
    address,
    "x-forwarded-for",
    address,
  ];
}
