import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export const visualFixtureValues = {
  providerKey: "task12_visual_provider_key_19b4df2d9a4d4ff0",
  providerEndpoint: "task12-visual-provider-endpoint-7d4de48a",
  email: "task12-visual-private-user@example.invalid",
  userId: "task12_visual_user_id_8de0fb6a",
  privateMessage: "task12_visual_private_message_324c850d",
  memoryContent: "task12_visual_private_memory_d9c318dd",
  exportId: "task12_visual_export_id_862b4067",
  rawError: "task12_visual_raw_error_17a454df",
} as const;

export const visualPrivacySentinels = Object.freeze(
  Object.values(visualFixtureValues),
) as readonly string[];

export async function assertVisualEvidenceFilesArePrivate(
  files: readonly string[],
  surface = "visual evidence",
): Promise<void> {
  const evidence = {
    light: files.some((file) => basename(file).includes("desktop-light")),
    dark: files.some((file) => basename(file).includes("desktop-dark")),
    mobile: files.some((file) => basename(file).includes("mobile")),
    error: files.some((file) => basename(file).includes("error-state")),
  };

  for (const [kind, present] of Object.entries(evidence)) {
    if (!present) throw new Error(`Missing visual privacy evidence: ${kind}`);
  }

  for (const file of files) {
    const bytes = await readFile(file);
    if (
      visualPrivacySentinels.some((sentinel) =>
        bytes.includes(Buffer.from(sentinel)),
      )
    ) {
      throw new Error(`Visual privacy sentinel found in ${surface}: ${file}`);
    }
  }
}
