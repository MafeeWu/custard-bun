import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, expect, test, vi } from "vitest";
import { authClient } from "@/server/auth/auth-client";
import { SignOutButton } from "./sign-out-button";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/server/auth/auth-client", () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("returns to the sign-in page after sign out", async () => {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
  vi.mocked(authClient.signOut).mockResolvedValue({
    data: { success: true },
    error: null,
  } as never);

  const user = userEvent.setup();

  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  expect(authClient.signOut).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledWith("/auth/sign-in");
});

test("keeps the visible button label stable and blocks duplicate sign-out requests while pending", async () => {
  const push = vi.fn();
  let resolveSignOut: ((value: unknown) => void) | undefined;

  vi.mocked(useRouter).mockReturnValue({ push } as never);
  vi.mocked(authClient.signOut).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }) as never,
  );

  const user = userEvent.setup();

  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  const button = screen.getByRole("button", { name: "Sign out" });

  expect(button).toBeDisabled();
  expect(button).toHaveClass("auth-form__submit");
  expect(button).toHaveAttribute("aria-busy", "true");

  await user.click(button);
  expect(authClient.signOut).toHaveBeenCalledOnce();

  resolveSignOut?.({ data: { success: true }, error: null });

  await waitFor(() => expect(push).toHaveBeenCalledWith("/auth/sign-in"));
});

test("shows an alert when sign out fails", async () => {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
  vi.mocked(authClient.signOut).mockResolvedValue({
    data: null,
    error: { message: "sign out failed" },
  } as never);

  const user = userEvent.setup();

  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  expect(screen.getByRole("alert")).toHaveTextContent(/unable to sign out/i);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

test("restores the button when sign out throws", async () => {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
  vi.mocked(authClient.signOut).mockRejectedValue(new Error("offline"));

  const user = userEvent.setup();

  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/unable to sign out/i);
  expect(push).not.toHaveBeenCalled();
});
