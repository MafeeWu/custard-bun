import type { AuthEmailJob } from "./email-job";

export interface RenderedEmail {
  subject: string;
  text: string;
}

const copy = {
  "verify-email": {
    subject: (brand: string) => `Verify your ${brand} email`,
    heading: "Verify your email",
  },
  "reset-password": {
    subject: (brand: string) => `Reset your ${brand} password`,
    heading: "Reset your password",
  },
  "delete-account": {
    subject: (brand: string) => `Confirm deletion of your ${brand} account`,
    heading: "Confirm account deletion",
  },
} as const;

export function renderAuthEmail(
  job: AuthEmailJob,
  brandName: string,
): RenderedEmail {
  const selected = copy[job.kind];

  return {
    subject: selected.subject(brandName),
    text: `${selected.heading}\n\nOpen this link to continue:\n${job.actionUrl}\n\nIf you did not request this, ignore this email.`,
  };
}
