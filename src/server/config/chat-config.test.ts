import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadRuntimeConfig } from "./load-config";
import { validSecretEnv, validYaml } from "@/test/unit/runtime-config-fixture";

const directories: string[] = [];

const validChatBlock = `chat:
  firstTokenTimeoutMs: 30000
  requestTimeoutMs: 120000
  promptTokenBudget: 8192
  maxInputCharacters: 12000
  maxOutputTokens: 1024
  defaultUserDailyRequestLimit: 100
  defaultUserDailyTokenLimit: 100000
  defaultInstanceMonthlyRequestLimit: 10000
  defaultInstanceMonthlyTokenBudget: 10000000
  maxConcurrentGenerations: 4
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
    `chat-config-${randomUUID()}`,
  );
  directories.push(directory);
  await mkdir(directory, { recursive: true });
  const configPath = path.join(directory, "app.config.yml");
  await writeFile(configPath, contents, "utf8");
  return configPath;
}

function fixtureWith(replacement: string) {
  if (replacement.startsWith("chat:\n")) {
    return validYaml.replace(validChatBlock, `${replacement}\n`);
  }

  const key = replacement.split(":")[0]?.trim();
  const currentLine = validChatBlock
    .trimEnd()
    .split("\n")
    .find((line) => line.trimStart().startsWith(`${key}:`));

  if (!currentLine) {
    throw new Error(`Unknown chat replacement: ${replacement}`);
  }

  return validYaml.replace(currentLine, `  ${replacement}`);
}

describe("chat runtime config", () => {
  test("loads deployable chat configuration", async () => {
    const configPath = await writeConfig(validYaml);
    const config = await loadRuntimeConfig({
      configPath,
      env: validSecretEnv,
    });

    expect(config.public.chat).toEqual({
      firstTokenTimeoutMs: 30000,
      requestTimeoutMs: 120000,
      promptTokenBudget: 8192,
      maxInputCharacters: 12000,
      maxOutputTokens: 1024,
      defaultUserDailyRequestLimit: 100,
      defaultUserDailyTokenLimit: 100000,
      defaultInstanceMonthlyRequestLimit: 10000,
      defaultInstanceMonthlyTokenBudget: 10000000,
      maxConcurrentGenerations: 4,
    });
  });

  test.each([
    ["unknown chat key", "chat:\n  unknown: true"],
    ["zero first-token timeout", "firstTokenTimeoutMs: 0"],
    ["total timeout below first-token timeout", "requestTimeoutMs: 1000"],
    ["output larger than prompt budget", "maxOutputTokens: 9000"],
    ["zero request limit", "defaultUserDailyRequestLimit: 0"],
    ["zero monthly token budget", "defaultInstanceMonthlyTokenBudget: 0"],
    ["zero concurrency", "maxConcurrentGenerations: 0"],
  ])("rejects %s", async (_title, replacement) => {
    const configPath = await writeConfig(fixtureWith(replacement));

    await expect(
      loadRuntimeConfig({ configPath, env: validSecretEnv }),
    ).rejects.toThrow();
  });
});
