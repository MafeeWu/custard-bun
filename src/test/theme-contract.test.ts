// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

function extractBlock(source: string, header: string) {
  const headerIndex = source.indexOf(header);

  expect(headerIndex).toBeGreaterThanOrEqual(0);

  const blockStart = source.indexOf("{", headerIndex);

  expect(blockStart).toBeGreaterThanOrEqual(0);

  let depth = 0;

  for (let index = blockStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(blockStart + 1, index);
      }
    }
  }

  throw new Error(`Missing closing brace for ${header}`);
}

test("theme stylesheet defines the semantic token contract", async () => {
  const css = await readFile("src/app/theme.css", "utf8");

  for (const token of [
    "--color-canvas",
    "--color-surface",
    "--color-border",
    "--color-text",
    "--color-text-muted",
    "--color-success",
    "--color-warning",
    "--color-danger",
  ]) {
    expect(css).toContain(token);
  }

  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).not.toContain("font-family: Inter");
});

test("accent-soft chat surfaces declare a dedicated readable foreground", async () => {
  const css = await readFile("src/app/globals.css", "utf8");

  expect(css).toMatch(
    /\.chat-version-notice\s*\{[^}]*color:\s*var\(--color-accent-soft-contrast\);/s,
  );
  expect(css).toMatch(
    /\.chat-message-user article\s*\{[^}]*color:\s*var\(--color-accent-soft-contrast\);/s,
  );
  expect(css).toMatch(
    /\.chat-message-user\s+\.chat-message-author,\s*\.chat-message-user\s+\.chat-message-status\s*\{[^}]*color:\s*var\(--color-accent-soft-contrast\);/s,
  );
});

test("chat conversation keeps the dynamic viewport contract", async () => {
  const css = await readFile("src/app/globals.css", "utf8");

  expect(css).toMatch(
    /\.chat-conversation\s*\{[^}]*min-height:\s*calc\(100dvh - 11rem\);/s,
  );
  expect(css).not.toMatch(
    /\.chat-conversation\s*\{[^}]*min-height:\s*calc\(100vh - 11rem\);/s,
  );
});

test("mobile eyebrow styling stays inside a valid character-eyebrow rule", async () => {
  const css = await readFile("src/app/globals.css", "utf8");
  const mobileBlock = extractBlock(css, "@media (max-width: 640px)");

  const hasEyebrowRule =
    /\.character-eyebrow\s*\{[^}]*font-weight:\s*700;[^}]*text-transform:\s*uppercase;[^}]*letter-spacing:\s*0\.04em;[^}]*\}/s.test(
      mobileBlock,
    );
  const hasOrphanDeclarations =
    /\}\s*font-weight:\s*700;\s*text-transform:\s*uppercase;\s*letter-spacing:\s*0\.04em;/s.test(
      mobileBlock,
    );

  expect(hasEyebrowRule).toBe(true);
  expect(hasOrphanDeclarations).toBe(false);
});
