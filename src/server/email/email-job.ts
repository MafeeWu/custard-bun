export type AuthEmailJob =
  | {
      kind: "verify-email";
      to: string;
      actionUrl: string;
    }
  | {
      kind: "reset-password";
      to: string;
      actionUrl: string;
    }
  | {
      kind: "delete-account";
      to: string;
      actionUrl: string;
    };

// Accepted through the same durable queue, but never delivered to SMTP.
export type EmailQueueJob = AuthEmailJob | { kind: "noop" };
