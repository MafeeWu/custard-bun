import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import HomePage from "./page";

test("renders a single primary action", () => {
  render(<HomePage />);

  expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
  expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
});
