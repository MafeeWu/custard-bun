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
    "decoded-exports",
    "app-logs",
    "worker-logs",
    "admin-html",
    "static-assets",
  ]) {
    await mkdir(`${root}/${name}/unexpected/nested`, { recursive: true });
    await writeFile(`${root}/${name}/unexpected/nested/file`, "safe content");
  }
  await writeFile(
    `${root}/responses/unexpected/nested/success`,
    JSON.stringify({ status: 200 }) + "\nsuccess body",
  );
  await writeFile(
    `${root}/responses/unexpected/nested/error`,
    JSON.stringify({ status: 404 }) + "\nerror body",
  );
}

test("scans every byte of every nested file in all required surfaces", async () => {
  await surfaces();
  expect(await scanPrivacySurfaces(root)).toMatchObject({
    files: 8,
    responseEvidence: { success: 1, error: 1 },
  });
});

test.each([
  "responses",
  "decoded-exports",
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

test.each(["success", "error"])(
  "fails closed without %s HTTP response evidence",
  async (kind) => {
    await surfaces();
    await rm(`${root}/responses/unexpected/nested/${kind}`);
    await expect(scanPrivacySurfaces(root)).rejects.toThrow(
      `Missing privacy evidence: ${kind} HTTP responses`,
    );
  },
);

test.each(["missing", "empty"])(
  "fails closed with %s decoded exports",
  async (kind) => {
    await surfaces();
    await rm(
      kind === "missing"
        ? `${root}/decoded-exports`
        : `${root}/decoded-exports/unexpected`,
      { recursive: true },
    );
    await expect(scanPrivacySurfaces(root)).rejects.toThrow();
  },
);

test("allows owner contents in responses and exports, never in operator surfaces", async () => {
  await surfaces();
  for (const surface of ["responses", "decoded-exports"]) {
    await writeFile(
      `${root}/${surface}/unexpected/nested/file`,
      privacySentinels.privateContent,
    );
  }
  await expect(scanPrivacySurfaces(root)).resolves.toMatchObject({ files: 8 });
  await writeFile(
    `${root}/worker-logs/unexpected/nested/file`,
    privacySentinels.privateContent,
  );
  await expect(scanPrivacySurfaces(root)).rejects.toThrow(
    "Privacy sentinel found in worker-logs",
  );
});

test("fails closed when a required surface has no evidence", async () => {
  await surfaces();
  await rm(`${root}/worker-logs`, { recursive: true });
  await expect(scanPrivacySurfaces(root)).rejects.toThrow();
});

test.each([
  privacySentinels.providerKey,
  privacySentinels.providerEndpoint,
  privacySentinels.otherUser,
])(
  "rejects a forbidden value in an unknown decoded export entry: %s",
  async (sentinel) => {
    await surfaces();
    await writeFile(
      `${root}/decoded-exports/unexpected/nested/not-a-known-entry.bin`,
      sentinel,
    );
    await expect(scanPrivacySurfaces(root)).rejects.toThrow(
      "Privacy sentinel found in decoded-exports",
    );
  },
);
