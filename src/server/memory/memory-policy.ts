import { ChatDomainError } from "@/server/chat/chat-errors";
import type { NormalizedMemoryCandidate } from "./memory-contracts";

const credentialPatterns = [
  /\bpassword\b/i,
  /\b(?:passwd|pwd|token|credentials?|cvv|cvc)\b/i,
  /\bpasscode\b/i,
  /\botp\b/i,
  /\b(?:mfa|2fa|(?:two|multi|2)[\s_-]?factor(?: authentication)?|authentication|verification|security)[\s_-]?code\b/i,
  /\b(?:my|your|authentication|security|login|card|bank(?:ing)?)\s+pin\b/i,
  /\bone[\s_-]?time[\s_-]?code\b/i,
  /\b(?:recovery|backup)[\s_-]?(?:code|key|phrase)\b/i,
  /\b(?:seed|mnemonic)[\s_-]?phrase\b/i,
  /\b(?:api|secret|private)[\s_-]?key\b/i,
  /\b(?:api|auth(?:entication)?|access|session|refresh|bearer)[\s_-]?token\b/i,
  /\b-----begin [a-z ]*private key-----\b/i,
  /\bsk[-_](?:(?:proj|svcacct|live|test)[-_])?[a-z0-9_-]{16,}\b/i,
  /\bgh[pousr]_[a-z0-9]+\b/i,
  /\bgithub_pat_[a-z0-9_]+\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/i,
  /\bAIza[a-z0-9_-]{30,}\b/i,
  /\bxox[baprs]-[a-z0-9-]+\b/i,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/i,
  /\bbearer\s+[a-z0-9._~+/-]{8,}=*/i,
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
  "cvv",
  "cvc",
  "security code",
] as const;

const personalSensitivePatterns = [
  /\b(?:health|medical|diagnos(?:is|ed|es|tic)|disease|disorder|syndrome|disability|disabled|medication|prescription|therapy|pregnan(?:t|cy)|mental health)\b/i,
  /\b(?:diabet(?:es|ic)|insulin|hiv|aids|cancer|epilepsy|asthma|depression|anxiety|bipolar|schizophrenia|autism|adhd|ptsd)\b/i,
  /\b(?:multiple sclerosis|allerg(?:y|ies|ic)|heart failure|hypertension|arthritis|dementia|alzheimer|parkinson|crohn|lupus)\b/i,
  /\b(?:religio(?:n|us)|faith|christian|christianity|catholic|protestant|jewish|judaism|muslim|islam|hindu|hinduism|buddhis[mt]|sikh|atheis[mt])\b/i,
  /\b(?:mormon|agnostic|orthodox|evangelical|sunni|shia|taois[mt])\b/i,
  /\b(?:sexual(?:ity| orientation)?|gender(?: identity)?|transgender|transsexual|nonbinary|non-binary|bisexual|homosexual|heterosexual|gay|lesbian|queer|ethnicity|ethnic|racial|race|nationality|passport|social security|ssn|identity number)\b/i,
  /\b(?:precise|exact|home|residential|street|mailing)\s+address\b/i,
  /\b(?:asian|african|hispanic|latino|latina|indigenous|arab|caucasian|woman|women|man|men|male|female|cisgender|intersex)\b/i,
  /\b\d{1,6}\s+(?:[\p{L}\d.-]+\s+){1,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|boulevard|blvd|way|place|pl)\b/iu,
  /(?:诊断|診斷|糖尿病|艾滋|抑郁|抑鬱|宗教|信仰|性取向|性别认同|性別認同|身份证|身份證|住址)/,
] as const;

export function isPersonalSensitiveMemory(content: string): boolean {
  return (
    personalSensitivePatterns.some((pattern) => pattern.test(content)) ||
    (/\b(?:black|white)\b/i.test(content) &&
      !/^(?:likes?|loves?|prefers?) (?:black (?:coffee|tea)|white tea)[.!?]?$/i.test(
        content,
      ))
  );
}

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

export function containsCredential(value: string): boolean {
  return (
    credentialPatterns.some((pattern) => pattern.test(value)) ||
    containsPaymentCardNumber(value) ||
    containsExplicitBankingCredential(value)
  );
}

export function assertMemoryCandidateAllowed(
  candidate: NormalizedMemoryCandidate,
): void {
  const normalizedLowerContent =
    candidate.normalizedContent.toLocaleLowerCase("en-US");

  if (containsCredential(normalizedLowerContent)) {
    throwValidationError(
      "Credential-class secrets and payment credentials cannot be stored as memory.",
    );
  }

  if (
    candidate.sensitivity !== "personal_explicit" &&
    !isPersonalSensitiveMemory(candidate.normalizedContent)
  ) {
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
