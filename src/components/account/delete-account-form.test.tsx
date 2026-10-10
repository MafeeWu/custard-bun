import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { requestAccountDeletionAction } from "@/app/account/delete/actions";
import { DeleteAccountForm } from "./delete-account-form";

vi.mock("@/app/account/delete/actions", () => ({
  requestAccountDeletionAction: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("requires the exact account email before enabling deletion", async () => {
  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  const emailInput = screen.getByLabelText("Confirm account email");

  await user.type(emailInput, "wrong@example.com");

  expect(screen.getByRole("button", { name: "Delete account" })).toBeDisabled();

  await user.clear(emailInput);
  await user.type(emailInput, "person@example.com");

  expect(screen.getByRole("button", { name: "Delete account" })).toBeEnabled();
});

test("requests a verification email rather than deleting immediately", async () => {
  vi.mocked(requestAccountDeletionAction).mockResolvedValue({
    status: "success",
    message: "A confirmation link has been sent to your email.",
  });

  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.type(
    screen.getByLabelText("Confirm account email"),
    "person@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(requestAccountDeletionAction).toHaveBeenCalledWith(
    { status: "idle" },
    expect.any(FormData),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "A confirmation link has been sent to your email.",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an alert when the deletion request returns an API error", async () => {
  vi.mocked(requestAccountDeletionAction).mockResolvedValue({
    status: "error",
    message: "Unable to request account deletion. Try again.",
  });

  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.type(
    screen.getByLabelText("Confirm account email"),
    "person@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to request account deletion/i,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("restores the button and shows an alert when the deletion request throws", async () => {
  vi.mocked(requestAccountDeletionAction).mockRejectedValue(
    new Error("offline"),
  );

  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.type(
    screen.getByLabelText("Confirm account email"),
    "person@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Delete account" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    /unable to request account deletion/i,
  );
});
