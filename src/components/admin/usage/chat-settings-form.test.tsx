import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import {
  resetGlobalChatSettingsAction,
  updateGlobalChatSettingsAction,
} from "@/app/admin/usage/actions";
import { ChatSettingsForm } from "./chat-settings-form";

vi.mock("@/app/admin/usage/actions", () => ({
  resetGlobalChatSettingsAction: vi.fn(),
  updateGlobalChatSettingsAction: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("applies reset values and submits the incremented revision on the next mutation", async () => {
  const user = userEvent.setup();
  vi.mocked(resetGlobalChatSettingsAction).mockResolvedValue({
    status: "success",
    message: "Deployment defaults restored.",
    values: {
      expectedRevision: "4",
      userDailyRequestLimit: "50",
      userDailyTokenLimit: "5000",
      instanceMonthlyRequestLimit: "500",
      instanceMonthlyTokenBudget: "50000",
      maxConcurrentGenerations: "2",
    },
  });
  vi.mocked(updateGlobalChatSettingsAction).mockResolvedValue({
    status: "success",
    message: "Chat settings updated.",
    values: {
      expectedRevision: "5",
      userDailyRequestLimit: "50",
      userDailyTokenLimit: "5000",
      instanceMonthlyRequestLimit: "500",
      instanceMonthlyTokenBudget: "50000",
      maxConcurrentGenerations: "2",
    },
  });

  render(
    <ChatSettingsForm
      settings={{
        revision: 3,
        userDailyRequestLimit: 100,
        userDailyTokenLimit: 10_000,
        instanceMonthlyRequestLimit: 1_000,
        instanceMonthlyTokenBudget: 100_000,
        maxConcurrentGenerations: 4,
      }}
    />,
  );

  await user.click(
    screen.getByLabelText("Restore the stored deployment defaults."),
  );
  await user.click(
    screen.getByRole("button", { name: "Reset to deployment defaults" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Deployment defaults restored.",
  );
  expect(screen.getByLabelText("User daily request limit")).toHaveValue(50);
  expect(screen.getByLabelText("User daily token limit")).toHaveValue(5_000);
  expect(screen.getByLabelText("Instance monthly request limit")).toHaveValue(
    500,
  );
  expect(screen.getByLabelText("Instance monthly token budget")).toHaveValue(
    50_000,
  );
  expect(screen.getByLabelText("Maximum concurrent generations")).toHaveValue(
    2,
  );

  await user.click(screen.getByRole("button", { name: "Save chat settings" }));
  await waitFor(() =>
    expect(updateGlobalChatSettingsAction).toHaveBeenCalledTimes(1),
  );
  const submitted = vi.mocked(updateGlobalChatSettingsAction).mock
    .calls[0]?.[1];
  expect(submitted).toBeInstanceOf(FormData);
  expect((submitted as FormData).get("expectedRevision")).toBe("4");
});
