import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { UserQuotaForm } from "./user-quota-form";

test("renders every validation message returned for a quota field", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({
    status: "error",
    message: "Check the quota override fields and try again.",
    fieldErrors: {
      dailyRequestLimit: [
        "Enter a positive whole number or leave blank to inherit.",
        "Keep the override below the deployment maximum.",
      ],
    },
    values: {
      dailyRequestLimit: "0",
      dailyTokenLimit: "",
    },
  });

  render(
    <UserQuotaForm
      user={{
        id: "user-1",
        name: "Ordinary One",
        dailyRequestLimit: null,
        dailyTokenLimit: null,
      }}
      action={action}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Save quota override" }));

  expect(
    await screen.findByText(
      "Enter a positive whole number or leave blank to inherit.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("Keep the override below the deployment maximum."),
  ).toBeVisible();
});
