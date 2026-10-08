import {
  characterContentSchema,
  characterSlugSchema,
  type CharacterContent,
} from "./character-content";

export type CharacterFormParseResult =
  | {
      success: true;
      data: {
        slug?: string;
        content: CharacterContent;
        expectedRevision?: number;
      };
    }
  | { success: false; fieldErrors: Record<string, string[]> };

const scalarFields = [
  "displayName",
  "avatarPath",
  "shortDescription",
  "longDescription",
  "speakingStyle",
  "responseRhythm",
  "openingMessage",
] as const;

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function lines(formData: FormData, name: string): string[] {
  return textValue(formData, name)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function zodFieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const [first, second] = issue.path;
    const field =
      first === "generationParameters" && typeof second === "string"
        ? second
        : typeof first === "string"
          ? first
          : "form";
    errors[field] ??= [];
    errors[field].push(issue.message);
  }
  return errors;
}

function numberField(
  formData: FormData,
  name: string,
  label: string,
  errors: Record<string, string[]>,
): number {
  const raw = textValue(formData, name).trim();
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value)) {
    errors[name] = [`${label} must be a valid number.`];
  }
  return value;
}

function optionalIntegerField(
  formData: FormData,
  name: string,
  label: string,
  errors: Record<string, string[]>,
): number | undefined {
  const raw = textValue(formData, name).trim();
  if (raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    errors[name] = [`${label} must be a valid number.`];
    return undefined;
  }
  return value;
}

function exampleConversations(
  formData: FormData,
  errors: Record<string, string[]>,
): CharacterContent["exampleConversations"] {
  const users = formData
    .getAll("exampleUser")
    .map((value) => (typeof value === "string" ? value.trim() : ""));
  const assistants = formData
    .getAll("exampleAssistant")
    .map((value) => (typeof value === "string" ? value.trim() : ""));
  const length = Math.max(users.length, assistants.length);
  const examples: CharacterContent["exampleConversations"] = [];

  for (let index = 0; index < length; index += 1) {
    const user = users[index] ?? "";
    const assistant = assistants[index] ?? "";

    if (!user && !assistant) {
      continue;
    }
    if (!user) {
      errors.exampleUser = ["Example user message is required."];
      continue;
    }
    if (!assistant) {
      errors.exampleAssistant = ["Example assistant response is required."];
      continue;
    }

    examples.push({ user, assistant });
  }

  return examples;
}

export function parseCharacterFormData(
  formData: FormData,
): CharacterFormParseResult {
  const fieldErrors: Record<string, string[]> = {};
  const expectedRevision = optionalIntegerField(
    formData,
    "expectedRevision",
    "Expected revision",
    fieldErrors,
  );
  const temperature = numberField(
    formData,
    "temperature",
    "Temperature",
    fieldErrors,
  );
  const topP = numberField(formData, "topP", "Top P", fieldErrors);
  const maxOutputTokens = numberField(
    formData,
    "maxOutputTokens",
    "Max output tokens",
    fieldErrors,
  );

  const input: Record<string, unknown> = {
    personalityPrinciples: lines(formData, "personalityPrinciples"),
    relationshipBoundaries: lines(formData, "relationshipBoundaries"),
    exampleConversations: exampleConversations(formData, fieldErrors),
    generationParameters: {
      temperature,
      topP,
      maxOutputTokens,
    },
    safetyAdditions: lines(formData, "safetyAdditions"),
  };

  for (const field of scalarFields) {
    input[field] = textValue(formData, field);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  const parsed = characterContentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: zodFieldErrors(parsed.error.issues),
    };
  }

  const slug = textValue(formData, "slug").trim();
  if (slug && !characterSlugSchema.safeParse(slug).success) {
    return {
      success: false,
      fieldErrors: {
        slug: ["Slug must use lowercase letters, numbers, and hyphens."],
      },
    };
  }

  return {
    success: true,
    data: {
      ...(slug ? { slug } : {}),
      content: parsed.data,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  };
}
