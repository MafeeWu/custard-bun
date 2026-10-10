import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadRuntimeConfig } from "./load-config";
import { validSecretEnv, validYaml } from "@/test/unit/runtime-config-fixture";

const directories: string[] = [];
const validMemoryBlock = `memory:
  enabled: true
  promptTokenBudget: 2048
  relationshipSummaryTokenBudget: 512
  memoryItemsTokenBudget: 1536
  maxActiveItemsPerCharacter: 200
  maxItemCharacters: 500
  maxSummaryCharacters: 4000
  extractionRetryLimit: 5
  extractionRetryDelaySeconds: 60
  exportRetentionHours: 24
  maxExportArchiveBytes: 262144000
`;

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeConfig(contents: string) {
  const directory = path.join(
    process.cwd(),
    "test-results",
    `config-${randomUUID()}`,
  );
  directories.push(directory);
  await mkdir(directory, { recursive: true });
  const configPath = path.join(directory, "app.config.yml");
  await writeFile(configPath, contents, "utf8");
  return configPath;
}

function fixtureWithMemory(replacement: string) {
  if (replacement.startsWith("memory:\n")) {
    return validYaml.replace(validMemoryBlock, `${replacement}\n`);
  }

  const key = replacement.split(":")[0]?.trim();
  const currentLine = validMemoryBlock
    .trimEnd()
    .split("\n")
    .find((line) => line.trimStart().startsWith(`${key}:`));

  if (!currentLine) {
    throw new Error(`Unknown memory replacement: ${replacement}`);
  }

  return validYaml.replace(currentLine, `  ${replacement}`);
}

describe("loadRuntimeConfig", () => {
  test("loads public branding and secrets", async () => {
    const configPath = await writeConfig(validYaml);
    const config = await loadRuntimeConfig({
      configPath,
      env: validSecretEnv,
    });

    expect(config.public.branding.name).toBe("Custard Bun");
    expect(config.public.registration.open).toBe(true);
    expect(config.public.chat.promptTokenBudget).toBe(8192);
    expect(config.public.memory).toEqual({
      enabled: true,
      promptTokenBudget: 2048,
      relationshipSummaryTokenBudget: 512,
      memoryItemsTokenBudget: 1536,
      maxActiveItemsPerCharacter: 200,
      maxItemCharacters: 500,
      maxSummaryCharacters: 4000,
      extractionRetryLimit: 5,
      extractionRetryDelaySeconds: 60,
      exportRetentionHours: 24,
      maxExportArchiveBytes: 262144000,
    });
    expect(config.secret.databaseUrl).toContain("postgresql://");
    expect(config.secret.model.modelId).toBe("test-chat-model");
  });

  test("rejects syntactically malformed YAML with app.config.yml.<root> prefix", async () => {
    const malformedYaml = "branding:\n  name: Custard Bun\n  invalid: : :";
    const configPath = await writeConfig(malformedYaml);

    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow(/^app\.config\.yml\.<root>:/);
  });

  test.each([
    [
      "unknown YAML key",
      validYaml + "\nunknown: true\n",
      validSecretEnv,
      "unknown",
    ],
    [
      "invalid primary color",
      validYaml.replace("#F59E0B", "orange"),
      validSecretEnv,
      "primaryColor",
    ],
    [
      "short auth secret",
      validYaml,
      { ...validSecretEnv, BETTER_AUTH_SECRET: "short" },
      "BETTER_AUTH_SECRET",
    ],
    [
      "empty HTTPS URL",
      validYaml.replace("https://example.com/privacy", "https://"),
      validSecretEnv,
      "privacyUrl",
    ],
    [
      "empty mailto URL",
      validYaml.replace("mailto:support@example.com", '"mailto:"'),
      validSecretEnv,
      "supportUrl",
    ],
    [
      "non-http auth URL",
      validYaml,
      { ...validSecretEnv, BETTER_AUTH_URL: "ftp://secret.example.com" },
      "BETTER_AUTH_URL",
    ],
    [
      "missing model API base URL",
      validYaml,
      { ...validSecretEnv, MODEL_API_BASE_URL: undefined },
      "MODEL_API_BASE_URL",
    ],
    [
      "missing model API key",
      validYaml,
      { ...validSecretEnv, MODEL_API_KEY: undefined },
      "MODEL_API_KEY",
    ],
    [
      "missing model ID",
      validYaml,
      { ...validSecretEnv, MODEL_ID: undefined },
      "MODEL_ID",
    ],
    [
      "non-http model API base URL",
      validYaml,
      { ...validSecretEnv, MODEL_API_BASE_URL: "ws://127.0.0.1:3102/v1" },
      "MODEL_API_BASE_URL",
    ],
    [
      "empty model ID",
      validYaml,
      { ...validSecretEnv, MODEL_ID: "" },
      "MODEL_ID",
    ],
    [
      "short model API key",
      validYaml,
      { ...validSecretEnv, MODEL_API_KEY: "short" },
      "MODEL_API_KEY",
    ],
  ])("rejects %s", async (_name, yaml, env, expectedField) => {
    const configPath = await writeConfig(yaml);

    await expect(loadRuntimeConfig({ configPath, env })).rejects.toThrow(
      expectedField,
    );
  });

  test("malformed YAML diagnostics never echo source values", async () => {
    const configPath = await writeConfig("branding:\n  secret: [private-token");
    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow("app.config.yml.<root>: Invalid YAML syntax");
    try {
      await loadRuntimeConfig({ configPath, env: validSecretEnv });
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
    }
  });

  test("rejects unknown memory keys when required fields are otherwise valid", async () => {
    const configPath = await writeConfig(
      validYaml.replace(validMemoryBlock, `${validMemoryBlock}  unknown: true\n`),
    );

    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow("unknown configuration key");
  });

  test("rejects memory item and summary budgets that exceed an otherwise valid memory prompt budget", async () => {
    const configPath = await writeConfig(
      validYaml
        .replace("  promptTokenBudget: 2048", "  promptTokenBudget: 1000")
        .replace(
          "  memoryItemsTokenBudget: 1536",
          "  memoryItemsTokenBudget: 600",
        ),
    );

    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow("relationshipSummaryTokenBudget");
  });

  test("rejects a valid memory prompt budget when it is not below the chat prompt budget", async () => {
    const configPath = await writeConfig(
      validYaml.replace("  promptTokenBudget: 8192", "  promptTokenBudget: 2047"),
    );

    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow("memory.promptTokenBudget");
  });

  test.each([
    ["retention other than 24 hours", "exportRetentionHours: 12", "24"],
    ["zero active-item limit", "maxActiveItemsPerCharacter: 0", "maxActiveItemsPerCharacter"],
    ["zero max item characters", "maxItemCharacters: 0", "maxItemCharacters"],
    ["zero max summary characters", "maxSummaryCharacters: 0", "maxSummaryCharacters"],
    ["zero extraction retry limit", "extractionRetryLimit: 0", "extractionRetryLimit"],
    [
      "zero extraction retry delay",
      "extractionRetryDelaySeconds: 0",
      "extractionRetryDelaySeconds",
    ],
    ["zero export archive bytes", "maxExportArchiveBytes: 0", "maxExportArchiveBytes"],
  ])("rejects %s", async (_title, replacement, expectedField) => {
    const configPath = await writeConfig(fixtureWithMemory(replacement));

    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow(expectedField);
  });
});
