// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, test } from "vitest";

async function uiFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? uiFiles(path) : entry.isFile() ? [path] : [];
    }),
  );
  return files.flat();
}

const trackedUiFiles = (
  await Promise.all(["src/app", "src/components"].map(uiFiles))
)
  .flat()
  .filter((file) => [".css", ".ts", ".tsx"].includes(extname(file)))
  .filter((file) => !/\.test\.[jt]sx?$/.test(file));

async function sources(files = trackedUiFiles) {
  return Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(file, "utf8"),
    })),
  );
}

function matchingFiles(
  entries: Awaited<ReturnType<typeof sources>>,
  pattern: RegExp,
) {
  return entries
    .filter(({ source }) => {
      pattern.lastIndex = 0;
      return pattern.test(source);
    })
    .map(({ file }) => file);
}

describe("tracked UI source preflight", () => {
  test("uses durable viewport, scroll, motion, and repository-owned asset contracts", async () => {
    const entries = await sources();

    expect(matchingFiles(entries, /\bh-screen\b/)).toEqual([]);
    expect(
      matchingFiles(entries, /window\.addEventListener\(\s*["']scroll["']/),
    ).toEqual([]);
    expect(matchingFiles(entries, /from\s+["']framer-motion["']/)).toEqual([]);
    expect(matchingFiles(entries, /<path\b/)).toEqual([]);
    expect(
      matchingFiles(
        entries,
        /https?:\/\/[^"'()\s]+\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|svg)\b/i,
      ),
    ).toEqual([]);
  });

  test("keeps legacy color literals inside the theme and accent contract", async () => {
    const entries = await sources(
      trackedUiFiles.filter((file) => file !== "src/app/theme.css"),
    );

    expect(matchingFiles(entries, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i)).toEqual(
      [],
    );
  });

  test("marks every motion module as a client boundary", async () => {
    const entries = await sources();
    const failures = entries
      .filter(({ source }) => /from\s+["']motion\/react["']/.test(source))
      .filter(({ source }) => !/^["']use client["'];/m.test(source))
      .map(({ file }) => file);

    expect(failures).toEqual([]);
  });

  test("imports icons from one package", async () => {
    const entries = await sources();
    const packages = new Set<string>();

    for (const { source } of entries) {
      for (const match of source.matchAll(
        /from\s+["']((?:@[^/"']+\/)?[^/"']*(?:icon|icons)[^"']*)["']/gi,
      )) {
        const specifier = match[1]!;
        packages.add(
          specifier.startsWith("@phosphor-icons/react")
            ? "@phosphor-icons/react"
            : specifier,
        );
      }
    }

    expect([...packages]).toEqual(["@phosphor-icons/react"]);
  });

  test("uses the icon SSR entry from Server Components", async () => {
    const entries = await sources();
    const failures = entries
      .filter(({ source }) => !/^["']use client["'];/m.test(source))
      .filter(({ source }) =>
        /from\s+["']@phosphor-icons\/react["']/.test(source),
      )
      .map(({ file }) => file);

    expect(failures).toEqual([]);
  });
});
