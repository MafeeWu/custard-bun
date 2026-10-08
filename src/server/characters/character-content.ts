import { z } from "zod";

const boundedLine = (maximum: number) => z.string().trim().min(1).max(maximum);

export const characterSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const avatarPathSchema = z.string().superRefine((value, context) => {
  if (
    !/^\/characters\/[A-Za-z0-9/_-]+\.(?:svg|png|webp|jpe?g)$/.test(value) ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    context.addIssue({
      code: "custom",
      message: "must be a site-relative character image path",
    });
  }
});

export const characterContentSchema = z
  .object({
    displayName: boundedLine(80),
    avatarPath: avatarPathSchema,
    shortDescription: boundedLine(200),
    longDescription: boundedLine(2_000),
    personalityPrinciples: z.array(boundedLine(300)).min(1).max(8),
    speakingStyle: boundedLine(1_000),
    responseRhythm: boundedLine(500),
    relationshipBoundaries: z.array(boundedLine(300)).min(1).max(8),
    openingMessage: boundedLine(1_000),
    exampleConversations: z
      .array(
        z
          .object({
            user: boundedLine(500),
            assistant: boundedLine(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    generationParameters: z
      .object({
        temperature: z.number().min(0).max(2),
        topP: z.number().min(0).max(1),
        maxOutputTokens: z.number().int().min(64).max(4_096),
      })
      .strict(),
    safetyAdditions: z.array(boundedLine(300)).max(8),
  })
  .strict();

export type CharacterContent = z.infer<typeof characterContentSchema>;
export type CharacterFieldGroup = keyof CharacterContent;
