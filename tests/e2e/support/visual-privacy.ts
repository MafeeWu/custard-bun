import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { visualPrivacySentinels } from "./visual-fixtures";

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
    const sentinel = visualPrivacySentinels.find((value) =>
      bytes.includes(Buffer.from(value)),
    );
    if (sentinel) {
      throw new Error(`Visual privacy sentinel found in ${file}`);
    }
  }

  return { files: files.length };
}
