import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { authClient } from "@/server/auth/auth-client";
import { SignUpForm } from "./sign-up-form";

vi.mock("@/server/auth/auth-client", () => ({
  authClient: {
    signUp: { email: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("submits name, email, password, and verification callback", async () => {
  vi.mocked(authClient.signUp.email).mockResolvedValue({
    data: { token: null, user: null },
    error: null,
  } as never);

  const user = userEvent.setup();

  render(<SignUpForm registrationOpen />);

  await user.type(screen.getByLabelText("Name"), "Person");
  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(authClient.signUp.email).toHaveBeenCalledWith({
    name: "Person",
    email: "person@example.com",
    password: "correct horse battery staple",
    callbackURL: "/auth/verify-email",
  });
  expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an alert when sign-up fails", async () => {
  vi.mocked(authClient.signUp.email).mockResolvedValue({
    data: null,
    error: { message: "Registration failed" },
  } as never);

  const user = userEvent.setup();

  render(<SignUpForm registrationOpen />);

  await user.type(screen.getByLabelText("Name"), "Person");
  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to create the account/i,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("restores the button when sign-up throws", async () => {
  vi.mocked(authClient.signUp.email).mockRejectedValue(
    new Error("network unavailable"),
  );

  const user = userEvent.setup();

  render(<SignUpForm registrationOpen />);

  await user.type(screen.getByLabelText("Name"), "Person");
  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to create the account/i,
  );
});

test("does not render a form when registration is closed", () => {
  render(<SignUpForm registrationOpen={false} />);

  expect(
    screen.queryByRole("form", { name: "Create account" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/registration is currently closed/i),
  ).toBeVisible();
});
