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

export async function scanPrivacySurfaces(
  root: string,
): Promise<{ files: number; surfaces: Record<string, number> }> {
  const counts: Record<string, number> = {};
  for (const surface of [
    "responses",
    "app-logs",
    "worker-logs",
    "admin-html",
    "static-assets",
  ]) {
    const files = await filesRecursively(join(root, surface));
    if (!files.length) throw new Error(`Missing privacy evidence: ${surface}`);
    counts[surface] = files.length;
    const forbidden =
      surface === "responses"
        ? [
            privacySentinels.providerKey,
            privacySentinels.providerEndpoint,
            privacySentinels.otherUser,
          ]
        : Object.values(privacySentinels);
    for (const file of files) {
      const bytes = await readFile(file);
      if (forbidden.some((sentinel) => bytes.includes(Buffer.from(sentinel)))) {
        throw new Error(`Privacy sentinel found in ${surface}: ${file}`);
      }
    }
  }
  return {
    files: Object.values(counts).reduce((sum, count) => sum + count, 0),
    surfaces: counts,
  };
}

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
