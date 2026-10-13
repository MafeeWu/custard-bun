import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button, LinkButton } from "./button";
import { EmptyState } from "./empty-state";
import { Field } from "./field";
import { IconButton } from "./icon-button";
import { PageHeader } from "./page-header";
import { Skeleton } from "./skeleton";
import { StatusNotice } from "./status-notice";

const globalsCss = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);
const statusNoticeRule =
  globalsCss.match(/\.ui-status-notice\s*\{[^}]*\}/s)?.[0] ?? "";

test("pending buttons keep their accessible name, disable submission, and announce busy state", () => {
  render(<Button pending>Save</Button>);

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText(/pending/i)).toHaveClass("sr-only");
});

test("danger buttons use the semantic danger variant instead of the accent variant", () => {
  render(<Button tone="danger">Delete account</Button>);

  const button = screen.getByRole("button", { name: "Delete account" });

  expect(button).toHaveClass("ui-button", "ui-button--danger");
  expect(button).not.toHaveClass("ui-button--primary");
});

test("link buttons render semantic CTA links", () => {
  render(<LinkButton href="/account">Manage account</LinkButton>);

  expect(screen.getByRole("link", { name: "Manage account" })).toHaveClass(
    "ui-button",
    "ui-link-button",
    "ui-button--primary",
  );
  expect(screen.getByRole("link", { name: "Manage account" })).toHaveAttribute(
    "href",
    "/account",
  );
});

test("fields link labels, hints, and errors through aria-describedby", () => {
  render(
    <Field
      htmlFor="email"
      label="Email"
      hint="We only use this for sign in."
      error="Enter a valid email"
    >
      <input id="email" />
    </Field>,
  );

  const input = screen.getByLabelText("Email");

  expect(input).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("hint"),
  );
  expect(input).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("error"),
  );
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email");
});

test("icon buttons require a non-empty accessible label", () => {
  expect(() => render(<IconButton label="">★</IconButton>)).toThrow(
    /non-empty label/i,
  );
});

test("status notices expose an accessible live region", () => {
  render(
    <StatusNotice tone="danger" title="Could not save">
      Try again in a moment.
    </StatusNotice>,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  expect(screen.getByText("Try again in a moment.")).toBeVisible();
});

test("status notices keep the semantic surface radius", () => {
  expect(statusNoticeRule).toContain("border-radius: var(--radius-surface);");
  expect(statusNoticeRule).not.toContain("border-radius: var(--radius-input);");
});

test("empty states render a heading and optional action", () => {
  render(
    <EmptyState
      title="No conversations yet"
      description="Start a new conversation to see it here."
      action={<LinkButton href="/characters">Browse characters</LinkButton>}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 2, name: "No conversations yet" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Browse characters" }),
  ).toHaveAttribute("href", "/characters");
});

test("skeleton placeholders stay hidden from assistive technology", () => {
  render(<Skeleton className="custom-skeleton" />);

  expect(screen.getByTestId("ui-skeleton")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

test("page headers render one heading at the requested level", () => {
  render(
    <PageHeader
      title="Account settings"
      description="Manage export and deletion preferences."
      headingLevel={2}
      actions={<Button tone="secondary">Export data</Button>}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 2, name: "Account settings" }),
  ).toBeVisible();
  expect(screen.getAllByRole("heading")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Export data" })).toBeVisible();
});

test("cta labels keep one-line button text", () => {
  expect(globalsCss).toMatch(
    /\.ui-button__label\s*\{[^}]*white-space:\s*nowrap;/s,
  );
});
