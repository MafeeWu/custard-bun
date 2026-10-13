import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { requestAccountDeletionAction } from "@/app/account/delete/actions";
import { DeleteAccountForm } from "./delete-account-form";

vi.mock("@/app/account/delete/actions", () => ({
  requestAccountDeletionAction: vi.fn(),
}));

beforeAll(() => {
  const prototype = HTMLDialogElement.prototype as HTMLDialogElement & {
    close?: () => void;
    showModal?: () => void;
  };

  if (!prototype.showModal) {
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
        this.setAttribute("open", "");
      },
    });
  }

  if (!prototype.close) {
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.removeAttribute("open");
      },
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("opens a danger dialog and requires the exact account email before enabling deletion", async () => {
  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.click(screen.getByRole("button", { name: "Delete account" }));

  const dialog = screen.getByRole("dialog", { name: "Delete account" });
  const emailInput = within(dialog).getByLabelText("Confirm account email");

  expect(
    within(dialog).getByText(
      "Deletion confirmation immediately signs you out and stops account access. Private data is then purged asynchronously. This cannot be undone.",
    ),
  ).toBeVisible();

  await user.type(emailInput, "wrong@example.com");

  expect(
    within(dialog).getByRole("button", { name: "Delete account" }),
  ).toBeDisabled();

  await user.clear(emailInput);
  await user.type(emailInput, "person@example.com");

  expect(
    within(dialog).getByRole("button", { name: "Delete account" }),
  ).toBeEnabled();
  expect(screen.queryByText("private-token")).not.toBeInTheDocument();
});

test("requests a verification email rather than deleting immediately", async () => {
  vi.mocked(requestAccountDeletionAction).mockResolvedValue({
    status: "success",
    message: "A confirmation link has been sent to your email.",
  });

  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.click(screen.getByRole("button", { name: "Delete account" }));

  const dialog = screen.getByRole("dialog", { name: "Delete account" });

  await user.type(
    within(dialog).getByLabelText("Confirm account email"),
    "person@example.com",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Delete account" }),
  );

  expect(requestAccountDeletionAction).toHaveBeenCalledWith(
    { status: "idle" },
    expect.any(FormData),
  );
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "A confirmation link has been sent to your email.",
  );
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an alert when the deletion request returns an API error", async () => {
  vi.mocked(requestAccountDeletionAction).mockResolvedValue({
    status: "error",
    message: "Unable to request account deletion. Try again.",
  });

  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.click(screen.getByRole("button", { name: "Delete account" }));

  const dialog = screen.getByRole("dialog", { name: "Delete account" });

  await user.type(
    within(dialog).getByLabelText("Confirm account email"),
    "person@example.com",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Delete account" }),
  );

  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    /unable to request account deletion/i,
  );
  expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
});

test("restores the button and shows an alert when the deletion request throws", async () => {
  vi.mocked(requestAccountDeletionAction).mockRejectedValue(
    new Error("offline"),
  );

  const user = userEvent.setup();

  render(<DeleteAccountForm email="person@example.com" />);

  await user.click(screen.getByRole("button", { name: "Delete account" }));

  const dialog = screen.getByRole("dialog", { name: "Delete account" });

  await user.type(
    within(dialog).getByLabelText("Confirm account email"),
    "person@example.com",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Delete account" }),
  );

  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Delete account" }),
    ).toBeEnabled(),
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    /unable to request account deletion/i,
  );
});
