// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CharacterDomainError } from "./character-errors";
import { verifyCharacterAvatarAsset } from "./avatar-assets";

let rootDirectory: string;

beforeEach(async () => {
  rootDirectory = await mkdtemp(
    path.join(process.cwd(), "test-results/avatar-assets-"),
  );
  await mkdir(path.join(rootDirectory, "public", "characters"), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(rootDirectory, { force: true, recursive: true });
});

describe("verifyCharacterAvatarAsset", () => {
  test("accepts an existing file below the public characters directory", async () => {
    await writeFile(
      path.join(rootDirectory, "public", "characters", "mira.svg"),
      "<svg />",
    );

    await expect(
      verifyCharacterAvatarAsset("/characters/mira.svg", rootDirectory),
    ).resolves.toBeUndefined();
  });

  test("throws MISSING_AVATAR_ASSET for a missing file without exposing absolute paths", async () => {
    await expect(
      verifyCharacterAvatarAsset("/characters/missing.svg", rootDirectory),
    ).rejects.toMatchObject({
      code: "MISSING_AVATAR_ASSET",
    });

    try {
      await verifyCharacterAvatarAsset(
        "/characters/missing.svg",
        rootDirectory,
      );
      throw new Error("Expected verifier to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterDomainError);
      expect((error as Error).message).not.toContain(rootDirectory);
      expect((error as Error).message).not.toContain(
        path.resolve(rootDirectory),
      );
    }
  });

  test("rejects a resolved path outside the public directory", async () => {
    await writeFile(path.join(rootDirectory, "secret.svg"), "<svg />");

    await expect(
      verifyCharacterAvatarAsset("/../secret.svg", rootDirectory),
    ).rejects.toMatchObject({
      code: "MISSING_AVATAR_ASSET",
    });
  });
});
