import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertVisualEvidenceFilesArePrivate,
  visualPrivacySentinels,
} from "../../release/visual-evidence";

export { visualPrivacySentinels };

async function filesRecursively(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory()
        ? filesRecursively(path)
        : entry.isFile()
          ? [path]
          : [];
    }),
  );
  return files.flat().sort();
}

export async function assertVisualEvidenceIsPrivate(
  root: string,
): Promise<{ files: number }> {
  const snapshotFiles = await filesRecursively(
    join(root, "tests/e2e/visual-redesign.spec.ts-snapshots"),
  );
  const resultFiles = await filesRecursively(
    join(root, "test-results/ui-evidence"),
  );
  const files = [...snapshotFiles, ...resultFiles];
  await assertVisualEvidenceFilesArePrivate(files);

  return { files: files.length };
}
