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

test("keeps the forgot-password form control order and autofill contract", () => {
  render(<ForgotPasswordForm />);

  const controls = screen
    .getByRole("form", { name: "Forgot password" })
    .querySelectorAll("input, button");

  expect(
    [...controls].map(
      (element) => element.getAttribute("name") ?? element.textContent,
    ),
  ).toEqual(["email", "Send reset link"]);
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "autocomplete",
    "email",
  );
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

test("keeps the visible button label stable and blocks duplicate submission while pending", async () => {
  let resolveResetRequest: ((value: unknown) => void) | undefined;
  vi.mocked(authClient.requestPasswordReset).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveResetRequest = resolve;
      }) as never,
  );

  const user = userEvent.setup();

  render(<ForgotPasswordForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  const button = screen.getByRole("button", { name: "Send reset link" });

  expect(button).toBeDisabled();
  expect(button).toHaveClass("auth-form__submit");
  expect(button).toHaveAttribute("aria-busy", "true");

  await user.click(button);
  expect(authClient.requestPasswordReset).toHaveBeenCalledOnce();

  resolveResetRequest?.({ data: { status: true }, error: null });

  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "If an account exists for that email, a reset link has been sent.",
    ),
  );
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
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("forgot-password-email-error"),
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
