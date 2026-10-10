import { z } from "zod";
import { ChatDomainError } from "@/server/chat/chat-errors";

export const memoryTypeValues = [
  "preferred_name",
  "preference",
  "important_person",
  "personal_fact",
  "future_plan",
  "shared_event",
  "commitment",
  "other",
] as const;

export type MemoryType = (typeof memoryTypeValues)[number];
export type MemoryExplicitness = "direct" | "repeated_inference";
export type MemorySensitivity = "ordinary" | "personal_explicit";

export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  sourceMessageId: string;
  explicitness: MemoryExplicitness;
  sensitivity: MemorySensitivity;
  userExplicitlyAskedToRemember: boolean;
  confidence: number;
  importance: number;
  mergeTargetDigest?: string;
}

export interface NormalizedMemoryCandidate extends MemoryCandidate {
  content: string;
  normalizedContent: string;
  normalizedDigest: string;
}

const memoryCandidateSchema = z
  .object({
    type: z.enum(memoryTypeValues),
    content: z
      .string()
      .min(1)
      .max(500)
      .refine((value) => value.trim().length > 0, "must not be blank"),
    sourceMessageId: z.uuid(),
    explicitness: z.enum(["direct", "repeated_inference"]),
    sensitivity: z.enum(["ordinary", "personal_explicit"]),
    userExplicitlyAskedToRemember: z.boolean(),
    confidence: z.number().min(0).max(100),
    importance: z.number().min(0).max(100),
    mergeTargetDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "must be a SHA-256 hex digest")
      .optional(),
  })
  .strict();

const memoryCandidatesSchema = z.array(memoryCandidateSchema).max(20);

function formatMemoryCandidateIssues(
  issues: Array<{ path: PropertyKey[]; message: string; code: string }>,
): string {
  return issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
      return `memoryCandidates.${field}: ${issue.code === "unrecognized_keys" ? "unknown memory candidate key" : issue.message}`;
    })
    .join("; ");
}

export function parseMemoryCandidates(value: unknown): MemoryCandidate[] {
  const result = memoryCandidatesSchema.safeParse(value);
  if (!result.success) {
    throw new ChatDomainError(
      "CHAT_VALIDATION",
      formatMemoryCandidateIssues(result.error.issues),
    );
  }

  return result.data.map((candidate) => ({
    ...candidate,
    mergeTargetDigest: candidate.mergeTargetDigest?.toLowerCase(),
  }));
}
