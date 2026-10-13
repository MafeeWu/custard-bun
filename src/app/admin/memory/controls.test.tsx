import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { updateGlobalMemorySettingsAction } from "./actions";
import { GlobalMemorySettingsForm } from "./controls";

vi.mock("./actions", () => ({
  resetGlobalMemorySettingsAction: vi.fn(),
  retryMemoryOperationAction: vi.fn(),
  updateGlobalMemorySettingsAction: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("renders every validation message returned for the memory setting", async () => {
  const user = userEvent.setup();
  vi.mocked(updateGlobalMemorySettingsAction).mockResolvedValue({
    status: "error",
    message: "Check the settings and try again.",
    fieldErrors: {
      enabled: [
        "Choose enabled or disabled.",
        "Reload if the available values have changed.",
      ],
    },
    values: {
      expectedRevision: "2",
      enabled: "true",
    },
  });

  render(
    <GlobalMemorySettingsForm
      settings={{
        revision: 2,
        enabled: true,
      }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Save memory setting" }));

  expect(await screen.findByText("Choose enabled or disabled.")).toBeVisible();
  expect(
    screen.getByText("Reload if the available values have changed."),
  ).toBeVisible();
});
