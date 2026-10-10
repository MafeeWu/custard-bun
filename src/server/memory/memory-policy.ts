import { ChatDomainError } from "@/server/chat/chat-errors";
import type { NormalizedMemoryCandidate } from "./memory-contracts";

const credentialPatterns = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\botp\b/i,
  /\bone-time code\b/i,
  /\brecovery code\b/i,
  /\b(?:api|secret|private)[\s_-]?key\b/i,
  /\b(?:api|auth(?:entication)?|access|session|refresh|bearer)[\s_-]?token\b/i,
  /\b-----begin [a-z ]*private key-----\b/i,
  /\bsk-(live|test)-[a-z0-9_-]+\b/i,
  /\bgh[pousr]_[a-z0-9]+\b/i,
] as const;

const bankCredentialMarkers = [
  "bank",
  "banking",
  "bank card",
  "payment card",
  "credit card",
  "debit card",
  "routing number",
  "account number",
  "iban",
  "swift",
] as const;

const bankingAuthMarkers = [
  "password",
  "passcode",
  "pin",
  "otp",
  "one-time code",
  "recovery code",
  "security answer",
  "login",
  "username",
  "user id",
] as const;

function throwValidationError(message: string): never {
  throw new ChatDomainError("CHAT_VALIDATION", message);
}

function isLuhnValid(value: string): boolean {
  let total = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const digit = Number.parseInt(value[index] ?? "", 10);
    if (!Number.isInteger(digit)) {
      return false;
    }

    let contribution = digit;
    if (shouldDouble) {
      contribution *= 2;
      if (contribution > 9) {
        contribution -= 9;
      }
    }

    total += contribution;
    shouldDouble = !shouldDouble;
  }

  return total % 10 === 0;
}

function containsPaymentCardNumber(value: string): boolean {
  const matches = value.matchAll(/\b(?:\d[ -]?){13,19}\b/g);

  for (const match of matches) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && isLuhnValid(digits)) {
      return true;
    }
  }

  return false;
}

function containsExplicitBankingCredential(value: string): boolean {
  return (
    bankCredentialMarkers.some((marker) => value.includes(marker)) &&
    bankingAuthMarkers.some((marker) => value.includes(marker))
  );
}

function containsCredential(value: string): boolean {
  return (
    credentialPatterns.some((pattern) => pattern.test(value)) ||
    containsPaymentCardNumber(value) ||
    containsExplicitBankingCredential(value)
  );
}

export function assertMemoryCandidateAllowed(
  candidate: NormalizedMemoryCandidate,
): void {
  const normalizedLowerContent = candidate.normalizedContent.toLocaleLowerCase(
    "en-US",
  );

  if (containsCredential(normalizedLowerContent)) {
    throwValidationError(
      "Credential-class secrets and payment credentials cannot be stored as memory.",
    );
  }

  if (candidate.sensitivity !== "personal_explicit") {
    return;
  }

  if (!candidate.userExplicitlyAskedToRemember) {
    throwValidationError(
      "Personal-sensitive memory requires the user to explicitly ask to remember it.",
    );
  }

  if (candidate.explicitness === "repeated_inference") {
    throwValidationError(
      "Personal-sensitive memory cannot be created from repeated inference.",
    );
  }
}
