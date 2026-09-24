import { z } from "zod";

const databaseUrlSchema = z
  .object({
    DATABASE_URL: z.string().url().startsWith("postgresql://"),
  })
  .strict();

function formatIssues(
  label: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
) {
  return issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
      return `${label}.${field}: ${issue.message}`;
    })
    .join("; ");
}

export function loadDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const result = databaseUrlSchema.safeParse({
    DATABASE_URL: env.DATABASE_URL,
  });

  if (!result.success) {
    throw new Error(formatIssues("environment", result.error.issues));
  }

  return result.data.DATABASE_URL;
}
