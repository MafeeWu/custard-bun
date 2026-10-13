import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertVisualEvidenceFilesArePrivate,
  visualPrivacySentinels,
} from "./visual-evidence";

export const privacySentinels = {
  providerKey: "task12_provider_key_76e4c681b7e7474e",
  providerEndpoint: "task12-provider-endpoint-299ce953ab6a469a",
  otherUser: "task12_other_user_phrase_429d6d9ef387438a",
  privateContent: "task12_private_memory_04fd0aef37014763",
};

export async function filesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? filesRecursively(join(root, entry.name))
        : entry.isFile()
          ? [join(root, entry.name)]
          : [],
    ),
  );
  return files.flat().sort();
}

export async function scanPrivacySurfaces(root: string): Promise<{
  files: number;
  surfaces: Record<string, number>;
  responseEvidence: { success: number; error: number };
}> {
  const counts: Record<string, number> = {};
  const responseEvidence = { success: 0, error: 0 };
  for (const surface of [
    "responses",
    "decoded-exports",
    "app-logs",
    "worker-logs",
    "admin-html",
    "static-assets",
    "ui-snapshots",
  ]) {
    const files = await filesRecursively(join(root, surface));
    if (!files.length) throw new Error(`Missing privacy evidence: ${surface}`);
    counts[surface] = files.length;
    const forbidden =
      surface === "responses" || surface === "decoded-exports"
        ? [
            privacySentinels.providerKey,
            privacySentinels.providerEndpoint,
            privacySentinels.otherUser,
          ]
        : surface === "ui-snapshots"
          ? [...Object.values(privacySentinels), ...visualPrivacySentinels]
          : Object.values(privacySentinels);
    for (const file of files) {
      const bytes = await readFile(file);
      if (forbidden.some((sentinel) => bytes.includes(Buffer.from(sentinel)))) {
        const kind =
          surface === "ui-snapshots" &&
          visualPrivacySentinels.some((sentinel) =>
            bytes.includes(Buffer.from(sentinel)),
          )
            ? "Visual privacy"
            : "Privacy";
        throw new Error(`${kind} sentinel found in ${surface}: ${file}`);
      }
      if (surface === "responses") {
        // Every file is scanned; only actual captured HTTP metadata counts as
        // response coverage, not filenames, decoded ZIPs, or arbitrary bytes.
        let status: unknown;
        try {
          status = JSON.parse(bytes.toString("utf8").split("\n", 1)[0]).status;
        } catch {
          continue;
        }
        if (typeof status === "number" && Number.isInteger(status)) {
          if (status >= 200 && status < 300) responseEvidence.success++;
          if (status >= 400 && status < 600) responseEvidence.error++;
        }
      }
    }
    if (surface === "ui-snapshots") {
      await assertVisualEvidenceFilesArePrivate(files, surface, [
        ...visualPrivacySentinels,
        ...Object.values(privacySentinels),
      ]);
    }
  }
  for (const kind of ["success", "error"] as const) {
    if (!responseEvidence[kind])
      throw new Error(`Missing privacy evidence: ${kind} HTTP responses`);
  }
  return {
    files: Object.values(counts).reduce((sum, count) => sum + count, 0),
    surfaces: counts,
    responseEvidence,
  };
}
