// @vitest-environment node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import {
  scanPrivacySurfaces,
  privacySentinels,
} from "../../tests/release/privacy-scan";
import {
  assertVisualEvidenceIsPrivate,
  visualPrivacySentinels,
} from "../../tests/e2e/support/visual-privacy";

const root = "test-results/privacy-scanner-unit";
const visualRoot = "test-results/visual-privacy-unit";
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(visualRoot, { recursive: true, force: true });
});

async function surfaces() {
  for (const name of [
    "responses",
    "decoded-exports",
    "app-logs",
    "worker-logs",
    "admin-html",
    "static-assets",
    "ui-snapshots",
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
    files: 9,
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
  "ui-snapshots",
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

async function visualEvidence() {
  const snapshotRoot = `${visualRoot}/tests/e2e/visual-redesign.spec.ts-snapshots`;
  const resultRoot = `${visualRoot}/test-results/ui-evidence/nested`;
  await mkdir(snapshotRoot, { recursive: true });
  await mkdir(resultRoot, { recursive: true });
  await writeFile(`${snapshotRoot}/home-desktop-light.png`, "safe light");
  await writeFile(`${snapshotRoot}/home-desktop-dark.png`, "safe dark");
  await writeFile(`${snapshotRoot}/home-mobile-light-reduced.png`, "safe mobile");
  await writeFile(`${resultRoot}/error-state.png`, "safe error");
}

test("recursively scans visual snapshots and runtime evidence", async () => {
  await visualEvidence();
  await expect(assertVisualEvidenceIsPrivate(visualRoot)).resolves.toEqual({
    files: 4,
  });
});

test.each(visualPrivacySentinels)(
  "rejects a visual privacy sentinel at any nested path: %s",
  async (sentinel) => {
    await visualEvidence();
    await writeFile(
      `${visualRoot}/test-results/ui-evidence/nested/error-state.png`,
      sentinel,
    );
    await expect(assertVisualEvidenceIsPrivate(visualRoot)).rejects.toThrow(
      "Visual privacy sentinel found",
    );
  },
);

test.each(["light", "dark", "mobile", "error"])(
  "fails closed without %s visual evidence",
  async (kind) => {
    await visualEvidence();
    const paths = {
      light: `${visualRoot}/tests/e2e/visual-redesign.spec.ts-snapshots/home-desktop-light.png`,
      dark: `${visualRoot}/tests/e2e/visual-redesign.spec.ts-snapshots/home-desktop-dark.png`,
      mobile: `${visualRoot}/tests/e2e/visual-redesign.spec.ts-snapshots/home-mobile-light-reduced.png`,
      error: `${visualRoot}/test-results/ui-evidence/nested/error-state.png`,
    };
    await rm(paths[kind as keyof typeof paths]);
    await expect(assertVisualEvidenceIsPrivate(visualRoot)).rejects.toThrow(
      `Missing visual privacy evidence: ${kind}`,
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
  await expect(scanPrivacySurfaces(root)).resolves.toMatchObject({ files: 9 });
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
