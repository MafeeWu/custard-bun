import { access } from "node:fs/promises";
import path from "node:path";
import { MissingAvatarAssetError } from "./character-errors";

function missingAvatarAsset(): MissingAvatarAssetError {
  return new MissingAvatarAssetError("Character avatar asset is missing");
}

export async function verifyCharacterAvatarAsset(
  avatarPath: string,
  rootDirectory = process.cwd(),
): Promise<void> {
  const publicDirectory = path.resolve(rootDirectory, "public");
  const resolvedPath = path.resolve(publicDirectory, avatarPath.slice(1));

  if (!resolvedPath.startsWith(`${publicDirectory}${path.sep}`)) {
    throw missingAvatarAsset();
  }

  try {
    await access(resolvedPath);
  } catch {
    throw missingAvatarAsset();
  }
}
