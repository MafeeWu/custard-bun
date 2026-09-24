import "server-only";

import type { PublicAppConfig } from "./schema";
import { getRuntimeConfig } from "./load-config";

export async function getPublicConfig(): Promise<PublicAppConfig> {
  return (await getRuntimeConfig()).public;
}
