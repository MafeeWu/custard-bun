import type { FullConfig } from "@playwright/test";
import { assertVisualEvidenceIsPrivate } from "./visual-privacy";

export default async function finalizeVisualPrivacy(config: FullConfig) {
  const root =
    typeof config.metadata.visualPrivacyRoot === "string"
      ? config.metadata.visualPrivacyRoot
      : process.cwd();
  const result = await assertVisualEvidenceIsPrivate(root);
  console.log(
    `Visual privacy finalization passed: ${result.files} files (bytes and raster OCR).`,
  );
}
