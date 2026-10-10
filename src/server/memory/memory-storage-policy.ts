import { getRuntimeConfig } from "@/server/config/load-config";
import type { RuntimeConfig } from "@/server/config/schema";

export type MemoryStoragePolicy = Pick<
  RuntimeConfig["public"]["memory"],
  "maxActiveItemsPerCharacter" | "maxItemCharacters"
>;

export async function memoryStoragePolicy(): Promise<MemoryStoragePolicy> {
  return (await getRuntimeConfig()).public.memory;
}
