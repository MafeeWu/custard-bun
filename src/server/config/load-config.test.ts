import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadRuntimeConfig } from "./load-config";
import { validSecretEnv, validYaml } from "@/test/unit/runtime-config-fixture";

async function writeConfig(contents: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "companion-config-"));
  const configPath = path.join(directory, "app.config.yml");
  await writeFile(configPath, contents, "utf8");
  return configPath;
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
    expect(config.secret.databaseUrl).toContain("postgresql://");
  });

  test.each([
    ["unknown YAML key", validYaml + "\nunknown: true\n", validSecretEnv, "unknown"],
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
  ])("rejects %s", async (_name, yaml, env, expectedField) => {
    const configPath = await writeConfig(yaml);

    await expect(loadRuntimeConfig({ configPath, env })).rejects.toThrow(
      expectedField,
    );
  });
});
