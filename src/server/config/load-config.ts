import "server-only";

import type { RuntimeConfig } from "./schema";
import {
  loadRuntimeConfig as loadRuntimeConfigInternal,
  type LoadRuntimeConfigInput,
} from "./runtime-config-core";

export type { LoadRuntimeConfigInput };

export function loadRuntimeConfig(
  input: LoadRuntimeConfigInput = {},
): Promise<RuntimeConfig> {
  return loadRuntimeConfigInternal(input);
}

let runtimeConfigPromise: Promise<RuntimeConfig> | undefined;

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeConfigPromise ??= loadRuntimeConfig();
  return runtimeConfigPromise;
}
