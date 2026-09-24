import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";
import { SignUpForm } from "./sign-up-form";
import { DeleteAccountForm } from "../account/delete-account-form";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=test-token"),
}));
vi.mock("@/server/auth/auth-client", () => {
  const limited = async () => ({
    error: { status: 429, message: "private details" },
  });
  return {
    authClient: {
      signUp: { email: limited },
      requestPasswordReset: limited,
      resetPassword: limited,
      deleteUser: limited,
    },
  };
});

test.each([
  [
    <ForgotPasswordForm key="forgot" />,
    "Send reset link",
    { Email: "test@example.com" },
  ],
  [
    <ResetPasswordForm key="reset" />,
    "Reset password",
    { "New password": "correct horse battery staple" },
  ],
  [
    <SignUpForm key="signup" registrationOpen />,
    "Create account",
    {
      Name: "Person",
      Email: "test@example.com",
      Password: "correct horse battery staple",
    },
  ],
  [
    <DeleteAccountForm key="delete" email="test@example.com" />,
    "Delete account",
    { "Confirm account email": "test@example.com" },
  ],
] as const)("rate limit guidance for %s", async (component, button, values) => {
  const user = userEvent.setup();
  render(component);
  for (const [label, value] of Object.entries(values)) {
    await user.type(screen.getByLabelText(label), value);
  }
  await user.click(screen.getByRole("button", { name: button }));
  expect(screen.getByRole("alert")).toHaveTextContent(/too many attempts/i);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).not.toHaveTextContent("private");
});
