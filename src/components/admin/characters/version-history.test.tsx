import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { VersionHistory } from "./version-history";

test("shows immutable versions, publication time, explicit default selection, and archive/restore controls", () => {
  render(
    <VersionHistory
      characterId="char-1"
      slug="calm-guide"
      lifecycle="active"
      defaultVersionId="v1"
      versions={[
        {
          id: "v2",
          versionNumber: 2,
          displayName: "Second",
          publishedAt: new Date("2026-10-08T01:02:03Z"),
        },
        {
          id: "v1",
          versionNumber: 1,
          displayName: "First",
          publishedAt: new Date("2026-10-07T01:02:03Z"),
        },
      ]}
      setDefaultAction={vi.fn()}
      archiveAction={vi.fn()}
      restoreAction={vi.fn()}
    />,
  );

  expect(screen.getByText("Version 2")).toBeVisible();
  expect(screen.getAllByText(/Published/)).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: "Set version 2 as default" }),
  ).toBeVisible();
  expect(screen.getByText("Current default")).toBeVisible();
  const archiveForm = screen.getByRole("group", { name: "Archive character" });
  expect(
    within(archiveForm).getByText(
      /Archive removes this character from public selection/,
    ),
  ).toBeVisible();
  expect(
    within(archiveForm).getByRole("button", { name: "Archive character" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /delete/i }),
  ).not.toBeInTheDocument();
});

test("shows an explicit restore confirmation for archived characters", () => {
  render(
    <VersionHistory
      characterId="char-1"
      slug="calm-guide"
      lifecycle="archived"
      defaultVersionId={null}
      versions={[]}
      setDefaultAction={vi.fn()}
      archiveAction={vi.fn()}
      restoreAction={vi.fn()}
    />,
  );

  const restoreForm = screen.getByRole("group", { name: "Restore character" });
  expect(
    within(restoreForm).getByText(/Restore makes this character eligible/),
  ).toBeVisible();
  expect(
    within(restoreForm).getByRole("button", { name: "Restore character" }),
  ).toBeVisible();
});
