import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { UserStatusForm } from "./user-status-form";

const idleAction = vi.fn(async () => ({ status: "idle" as const }));

test("disable form requires a visible reason and explicit confirmation", () => {
  render(
    <UserStatusForm
      user={{
        id: "user-1",
        name: "Ordinary",
        email: "u@example.com",
        banned: false,
      }}
      disableAction={idleAction}
      restoreAction={idleAction}
    />,
  );

  const group = screen.getByRole("group", { name: "Disable Ordinary" });
  expect(
    within(group).getByLabelText("Reason for disabling user"),
  ).toBeRequired();
  expect(
    within(group).getByRole("checkbox", {
      name: /I understand this signs out the user/i,
    }),
  ).toBeRequired();
  expect(
    within(group).getByRole("button", { name: "Disable user" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /delete|role|impersonate|password/i }),
  ).not.toBeInTheDocument();
});

test("restore form has a distinct label and renders action errors as alerts", () => {
  render(
    <UserStatusForm
      user={{
        id: "user-1",
        name: "Ordinary",
        email: "u@example.com",
        banned: true,
      }}
      disableAction={idleAction}
      restoreAction={idleAction}
      restoreState={{ status: "error", message: "User is already active." }}
    />,
  );

  const group = screen.getByRole("group", { name: "Restore Ordinary" });
  expect(
    within(group).getByRole("button", { name: "Restore user" }),
  ).toBeVisible();
  expect(within(group).getByRole("alert")).toHaveTextContent(
    "User is already active.",
  );
  expect(
    screen.queryByLabelText("Reason for disabling user"),
  ).not.toBeInTheDocument();
});
