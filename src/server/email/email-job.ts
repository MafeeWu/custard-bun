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
