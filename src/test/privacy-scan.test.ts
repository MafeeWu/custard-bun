// @vitest-environment node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import {
  scanPrivacySurfaces,
  privacySentinels,
} from "../../tests/release/privacy-scan";

const root = "test-results/privacy-scanner-unit";
afterEach(() => rm(root, { recursive: true, force: true }));

async function surfaces() {
  for (const name of [
    "responses",
    "app-logs",
    "worker-logs",
    "admin-html",
    "static-assets",
  ]) {
    await mkdir(`${root}/${name}/unexpected/nested`, { recursive: true });
    await writeFile(`${root}/${name}/unexpected/nested/file`, "safe content");
  }
}

test("scans every byte of every nested file in all required surfaces", async () => {
  await surfaces();
  expect(await scanPrivacySurfaces(root)).toMatchObject({ files: 5 });
});

test.each([
  "responses",
  "app-logs",
  "worker-logs",
  "admin-html",
  "static-assets",
])("rejects a secret at an unknown path in %s", async (surface) => {
  await surfaces();
  await writeFile(
    `${root}/${surface}/unexpected/nested/file`,
    privacySentinels.providerKey,
  );
  await expect(scanPrivacySurfaces(root)).rejects.toThrow(
    `Privacy sentinel found in ${surface}`,
  );
});

test("fails closed when a required surface has no evidence", async () => {
  await surfaces();
  await rm(`${root}/worker-logs`, { recursive: true });
  await expect(scanPrivacySurfaces(root)).rejects.toThrow();
});
