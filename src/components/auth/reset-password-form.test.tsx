import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSearchParams } from "next/navigation";
import { beforeEach, expect, test, vi } from "vitest";
import { authClient } from "@/server/auth/auth-client";
import { ResetPasswordForm } from "./reset-password-form";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

vi.mock("@/server/auth/auth-client", () => ({
  authClient: {
    resetPassword: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams("token=reset-token") as never,
  );
});

test("keeps the reset-password form contract for field order, autofill, and password bounds", () => {
  render(<ResetPasswordForm />);

  const controls = screen
    .getByRole("form", { name: "Reset password" })
    .querySelectorAll("input, button");

  expect(
    [...controls].map(
      (element) => element.getAttribute("name") ?? element.textContent,
    ),
  ).toEqual(["password", "Reset password"]);
  expect(screen.getByLabelText("New password")).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  expect(screen.getByLabelText("New password")).toHaveAttribute(
    "minlength",
    "12",
  );
  expect(screen.getByLabelText("New password")).toHaveAttribute(
    "maxlength",
    "128",
  );
});

test("resets the password with the token from the page", async () => {
  vi.mocked(authClient.resetPassword).mockResolvedValue({
    data: { status: true },
    error: null,
  } as never);

  const user = userEvent.setup();

  render(<ResetPasswordForm />);

  await user.type(
    screen.getByLabelText("New password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  expect(authClient.resetPassword).toHaveBeenCalledWith({
    token: "reset-token",
    newPassword: "correct horse battery staple",
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    /your password has been reset/i,
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("keeps the visible button label stable and blocks duplicate submission while pending", async () => {
  let resolveReset: ((value: unknown) => void) | undefined;
  vi.mocked(authClient.resetPassword).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveReset = resolve;
      }) as never,
  );

  const user = userEvent.setup();

  render(<ResetPasswordForm />);

  await user.type(
    screen.getByLabelText("New password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  const button = screen.getByRole("button", { name: "Reset password" });

  expect(button).toBeDisabled();
  expect(button).toHaveClass("auth-form__submit");
  expect(button).toHaveAttribute("aria-busy", "true");

  await user.click(button);
  expect(authClient.resetPassword).toHaveBeenCalledOnce();

  resolveReset?.({ data: { status: true }, error: null });

  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      /your password has been reset/i,
    ),
  );
});

test("shows an alert when the reset link is rejected", async () => {
  vi.mocked(authClient.resetPassword).mockResolvedValue({
    data: null,
    error: { message: "Invalid reset token" },
  } as never);

  const user = userEvent.setup();

  render(<ResetPasswordForm />);

  await user.type(
    screen.getByLabelText("New password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    /this reset link is invalid or has expired/i,
  );
  expect(screen.getByLabelText("New password")).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("reset-password-error"),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("restores the button when the reset request throws", async () => {
  vi.mocked(authClient.resetPassword).mockRejectedValue(
    new Error("network unavailable"),
  );

  const user = userEvent.setup();

  render(<ResetPasswordForm />);

  await user.type(
    screen.getByLabelText("New password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Reset password" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to reset your password/i,
  );
});
