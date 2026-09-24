import { APIError } from "better-auth/api";

export function assertRegistrationOpen(open: boolean): void {
  if (!open) {
    throw new APIError("FORBIDDEN", {
      message: "Registration is currently closed",
    });
  }
}
