export type CharacterErrorCode =
  | "CHARACTER_NOT_FOUND"
  | "DRAFT_CONFLICT"
  | "UNCHANGED_DRAFT"
  | "INVALID_DEFAULT_VERSION"
  | "MISSING_AVATAR_ASSET"
  | "INVALID_CHARACTER_STATE";

export abstract class CharacterDomainError extends Error {
  constructor(
    public readonly code: CharacterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CharacterNotFoundError extends CharacterDomainError {
  constructor(message = "Character not found") {
    super("CHARACTER_NOT_FOUND", message);
  }
}

export class DraftConflictError extends CharacterDomainError {
  constructor(message = "Character draft changed in a conflicting way") {
    super("DRAFT_CONFLICT", message);
  }
}

export class UnchangedDraftError extends CharacterDomainError {
  constructor(message = "Character draft has no changes") {
    super("UNCHANGED_DRAFT", message);
  }
}

export class InvalidDefaultVersionError extends CharacterDomainError {
  constructor(message = "Default version selection is invalid") {
    super("INVALID_DEFAULT_VERSION", message);
  }
}

export class MissingAvatarAssetError extends CharacterDomainError {
  constructor(message = "Character avatar asset is missing") {
    super("MISSING_AVATAR_ASSET", message);
  }
}

export class InvalidCharacterStateError extends CharacterDomainError {
  constructor(message = "Character state is invalid") {
    super("INVALID_CHARACTER_STATE", message);
  }
}
