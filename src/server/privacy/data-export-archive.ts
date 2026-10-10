import "server-only";
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";

export const MAX_EXPORT_ARCHIVE_BYTES = 262_144_000;
export const EXPORT_ENTRY_NAMES = [
  "audit.json",
  "characters.json",
  "conversations.json",
  "manifest.json",
  "memories.json",
  "profile.json",
  "settings.json",
  "summaries.json",
  "usage.json",
] as const;

export class ExportArchiveError extends Error {
  constructor(readonly category: "size_limit" | "validation") {
    super("Unable to create data export archive.");
    this.name = "ExportArchiveError";
  }
}

export function validateArchiveLimit(maxBytes: number): void {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_EXPORT_ARCHIVE_BYTES
  )
    throw new ExportArchiveError("validation");
}

export function archiveDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Stored ZIP entries have an exact, conservative size estimate, independent of compression ratios.
export class DataExportArchiveBuilder {
  private readonly entries = new Map<string, Uint8Array>();
  private estimatedSize = 22;

  constructor(private readonly maxBytes = MAX_EXPORT_ARCHIVE_BYTES) {
    validateArchiveLimit(maxBytes);
  }

  add(name: string, value: unknown): void {
    if (
      !EXPORT_ENTRY_NAMES.includes(
        name as (typeof EXPORT_ENTRY_NAMES)[number],
      ) ||
      name === "manifest.json" ||
      this.entries.has(name)
    )
      throw new ExportArchiveError("validation");
    const json = JSON.stringify(value);
    if (typeof json !== "string") throw new ExportArchiveError("validation");
    const length = Buffer.byteLength(json, "utf8");
    this.estimatedSize += length + 76 + 2 * Buffer.byteLength(name);
    if (this.estimatedSize > this.maxBytes)
      throw new ExportArchiveError("size_limit");
    this.entries.set(name, strToU8(json));
  }

  finish(snapshotAt: string) {
    if (!Number.isFinite(Date.parse(snapshotAt)))
      throw new ExportArchiveError("validation");
    const names = [...this.entries.keys()].sort();
    const manifest = strToU8(
      JSON.stringify({
        schemaVersion: 1,
        snapshotAt,
        format: "custard-bun-data-export",
        entries: names.map((name) => ({
          name,
          bytes: this.entries.get(name)!.length,
          sha256: archiveDigest(this.entries.get(name)!),
        })),
      }),
    );
    this.estimatedSize += manifest.length + 76 + 2 * "manifest.json".length;
    if (this.estimatedSize > this.maxBytes)
      throw new ExportArchiveError("size_limit");
    const zipEntries: Zippable = {};
    // fflate encodes local DOS time; a fixed local date is stable across process timezones.
    const mtime = new Date(1980, 0, 1, 0, 0, 0);
    for (const name of [...names, "manifest.json"].sort())
      zipEntries[name] = [
        name === "manifest.json" ? manifest : this.entries.get(name)!,
        { level: 0, mtime },
      ];
    const bytes = Buffer.from(zipSync(zipEntries, { level: 0 }));
    if (bytes.length > this.maxBytes)
      throw new ExportArchiveError("size_limit");
    return { bytes, size: bytes.length, sha256: archiveDigest(bytes) };
  }
}

export function buildDataExportArchive(
  entries: Record<string, unknown>,
  snapshotAt: string,
  maxBytes = MAX_EXPORT_ARCHIVE_BYTES,
) {
  const builder = new DataExportArchiveBuilder(maxBytes);
  for (const name of Object.keys(entries).sort())
    builder.add(name, entries[name]);
  return builder.finish(snapshotAt);
}
