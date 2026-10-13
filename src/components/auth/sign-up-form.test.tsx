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

test("keeps the sign-up form contract for field order, autofill, and password bounds", () => {
  render(<SignUpForm registrationOpen />);

  const controls = screen
    .getByRole("form", { name: "Create account" })
    .querySelectorAll("input, button");

  expect(
    [...controls].map(
      (element) => element.getAttribute("name") ?? element.textContent,
    ),
  ).toEqual(["name", "email", "password", "Create account"]);

  expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "autocomplete",
    "email",
  );
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "12");
  expect(screen.getByLabelText("Password")).toHaveAttribute("maxlength", "128");
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

test("keeps the visible button label stable and blocks duplicate submission while pending", async () => {
  let resolveSignUp: ((value: unknown) => void) | undefined;
  vi.mocked(authClient.signUp.email).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSignUp = resolve;
      }) as never,
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

  const button = screen.getByRole("button", { name: "Create account" });

  expect(button).toBeDisabled();
  expect(button).toHaveClass("auth-form__submit");
  expect(button).toHaveAttribute("aria-busy", "true");

  await user.click(button);
  expect(authClient.signUp.email).toHaveBeenCalledOnce();

  resolveSignUp?.({ data: { token: null, user: null }, error: null });

  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(/check your email/i),
  );
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
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("sign-up-email-error"),
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
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeEnabled(),
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
  expect(screen.getByText(/registration is currently closed/i)).toBeVisible();
});
