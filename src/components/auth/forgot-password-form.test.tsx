import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { authClient } from "@/server/auth/auth-client";
import { ForgotPasswordForm } from "./forgot-password-form";

vi.mock("@/server/auth/auth-client", () => ({
  authClient: {
    requestPasswordReset: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("requests a reset link and shows the generic success message", async () => {
  vi.mocked(authClient.requestPasswordReset).mockResolvedValue({
    data: { status: true },
    error: null,
  } as never);

  const user = userEvent.setup();

  render(<ForgotPasswordForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(authClient.requestPasswordReset).toHaveBeenCalledWith({
    email: "person@example.com",
    redirectTo: "/auth/reset-password",
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "If an account exists for that email, a reset link has been sent.",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an alert when requesting a reset link fails", async () => {
  vi.mocked(authClient.requestPasswordReset).mockResolvedValue({
    data: null,
    error: { message: "Unavailable" },
  } as never);

  const user = userEvent.setup();

  render(<ForgotPasswordForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to send a reset link/i,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("restores the button when the reset request throws", async () => {
  vi.mocked(authClient.requestPasswordReset).mockRejectedValue(
    new Error("network unavailable"),
  );

  const user = userEvent.setup();

  render(<ForgotPasswordForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send reset link" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to send a reset link/i,
  );
});
