// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

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
