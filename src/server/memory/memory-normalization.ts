import { createHash } from "node:crypto";
import type {
  MemoryCandidate,
  MemoryType,
  NormalizedMemoryCandidate,
} from "./memory-contracts";

export function normalizeMemoryText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function memoryDigest(input: {
  type: MemoryType;
  normalizedContent: string;
}): string {
  return createHash("sha256")
    .update(`${input.type}\0${input.normalizedContent.toLocaleLowerCase("en-US")}`)
    .digest("hex");
}

export function normalizeMemoryCandidate(
  candidate: MemoryCandidate,
): NormalizedMemoryCandidate {
  const normalizedContent = normalizeMemoryText(candidate.content);

  return {
    ...candidate,
    content: normalizedContent,
    normalizedContent,
    normalizedDigest: memoryDigest({
      type: candidate.type,
      normalizedContent,
    }),
    ...(candidate.mergeTargetDigest
      ? { mergeTargetDigest: candidate.mergeTargetDigest.toLowerCase() }
      : {}),
  };
}
