// @vitest-environment node
import { expect, test, vi } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import {
  DataExportArchiveBuilder,
  MAX_EXPORT_ARCHIVE_BYTES,
  buildDataExportArchive,
} from "./data-export-archive";
vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return { ...actual, zipSync: vi.fn(actual.zipSync) };
});
const snapshotAt = "2026-10-10T08:00:00.000Z";
test("ZIP order, UTF-8 JSON and timestamp are deterministic regardless of entry insertion order", () => {
  const a = buildDataExportArchive(
    { "profile.json": { name: "茶 ☕" }, "usage.json": [] },
    snapshotAt,
  );
  const b = buildDataExportArchive(
    { "usage.json": [], "profile.json": { name: "茶 ☕" } },
    snapshotAt,
  );
  expect(a).toEqual(b);
  expect(Object.keys(unzipSync(a.bytes))).toEqual([
    "manifest.json",
    "profile.json",
    "usage.json",
  ]);
  expect(JSON.parse(strFromU8(unzipSync(a.bytes)["profile.json"]))).toEqual({
    name: "茶 ☕",
  });
  expect(
    buildDataExportArchive(
      { "profile.json": { name: "茶 ☕" }, "usage.json": [] },
      snapshotAt,
      a.size,
    ).size,
  ).toBe(a.size);
  expect(() =>
    buildDataExportArchive(
      { "profile.json": { name: "茶 ☕" }, "usage.json": [] },
      snapshotAt,
      a.size - 1,
    ),
  ).toThrow();
});
test("final archive bound is checked independently of the estimated JSON bound", () => {
  vi.mocked(zipSync).mockReturnValueOnce(new Uint8Array(1025));
  expect(() =>
    buildDataExportArchive({ "usage.json": [] }, snapshotAt, 1024),
  ).toThrow();
});
test.each([
  "../profile.json",
  "/profile.json",
  "a\\profile.json",
  "manifest.json",
  "__proto__",
  "unknown.json",
])("unsafe/unapproved name %s is rejected", (name) => {
  const builder = new DataExportArchiveBuilder();
  expect(() => builder.add(name, {})).toThrow();
});
test("duplicate names and invalid config are rejected before building", () => {
  const builder = new DataExportArchiveBuilder();
  builder.add("profile.json", {});
  expect(() => builder.add("profile.json", {})).toThrow();
  expect(MAX_EXPORT_ARCHIVE_BYTES).toBe(262144000);
  for (const value of [0, -1, 1.5, Number.NaN, 262144001])
    expect(() => new DataExportArchiveBuilder(value)).toThrow();
});
