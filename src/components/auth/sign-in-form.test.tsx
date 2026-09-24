import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, expect, test, vi } from "vitest";
import { authClient } from "@/server/auth/auth-client";
import { SignInForm } from "./sign-in-form";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/server/auth/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("redirects to the application after sign in", async () => {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
  vi.mocked(authClient.signIn.email).mockResolvedValue({
    data: { redirect: false, token: "session", url: undefined, user: {} },
    error: null,
  } as never);

  const user = userEvent.setup();

  render(<SignInForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(authClient.signIn.email).toHaveBeenCalledWith({
    email: "person@example.com",
    password: "correct horse battery staple",
    rememberMe: true,
  });
  expect(push).toHaveBeenCalledWith("/app");
});

test("shows verification guidance for a 403 response", async () => {
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
  vi.mocked(authClient.signIn.email).mockResolvedValue({
    data: null,
    error: {
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
      message: "Email not verified",
    },
  } as never);

  const user = userEvent.setup();

  render(<SignInForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Verify your email before signing in.",
  );
});

test("shows an alert instead of a success status for credential errors", async () => {
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
  vi.mocked(authClient.signIn.email).mockResolvedValue({
    data: null,
    error: { status: 401, message: "Invalid credentials" },
  } as never);

  const user = userEvent.setup();

  render(<SignInForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "wrong horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    /invalid email or password/i,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("restores the button when sign-in throws", async () => {
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
  vi.mocked(authClient.signIn.email).mockRejectedValue(
    new Error("gateway timeout"),
  );

  const user = userEvent.setup();

  render(<SignInForm />);

  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/unable to sign in/i);
});

test.each([
  [429, "RATE_LIMIT", /too many attempts/i],
  [403, "BANNED_USER", /sign-in is unavailable/i],
  [403, "FORBIDDEN", /sign-in is unavailable/i],
])("provides safe typed guidance for %s %s", async (status, code, expected) => {
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as never);
  vi.mocked(authClient.signIn.email).mockResolvedValue({
    data: null,
    error: { status, code, message: "private account exists" },
  } as never);
  const user = userEvent.setup();
  render(<SignInForm />);
  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("alert")).toHaveTextContent(expected);
  expect(screen.getByRole("alert")).not.toHaveTextContent(/private|verify/i);
});
