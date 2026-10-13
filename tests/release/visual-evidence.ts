import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { createWorker, OEM, type Worker } from "tesseract.js";

const require = createRequire(resolve("package.json"));
const english = require("@tesseract.js-data/eng") as {
  langPath: string;
  gzip: boolean;
};
const recognizedImages = new Map<string, string>();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

function normalizedText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/[il]/g, "1")
    .replace(/o/g, "0");
}

function containsRasterSentinel(text: string, sentinels: readonly string[]) {
  const normalized = normalizedText(text);
  return sentinels.some((sentinel) => {
    const stem = sentinel.replace(/[_-][a-f0-9]{8,}$/i, "");
    return normalized.includes(normalizedText(stem));
  });
}

export async function assertVisualEvidenceFilesArePrivate(
  files: readonly string[],
  surface = "visual evidence",
  sentinels: readonly string[] = visualPrivacySentinels,
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

  let worker: Worker | undefined;
  try {
    for (const file of files) {
      const bytes = await readFile(file);
      if (sentinels.some((sentinel) => bytes.includes(Buffer.from(sentinel)))) {
        throw new Error(`Visual privacy sentinel found in ${surface}: ${file}`);
      }
      if (!file.toLowerCase().endsWith(".png")) continue;
      if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
        throw new Error(`Invalid PNG visual evidence in ${surface}: ${file}`);
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      let text = recognizedImages.get(digest);
      if (text === undefined) {
        worker ??= await createWorker("eng", OEM.LSTM_ONLY, {
          langPath: english.langPath,
          gzip: english.gzip,
          cacheMethod: "none",
        });
        text = (await worker.recognize(bytes)).data.text;
        recognizedImages.set(digest, text);
      }
      if (containsRasterSentinel(text, sentinels)) {
        throw new Error(`Visual privacy sentinel found in ${surface}: ${file}`);
      }
    }
  } finally {
    await worker?.terminate();
  }
}
