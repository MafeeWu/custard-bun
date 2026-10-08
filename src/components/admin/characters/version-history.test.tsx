import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { VersionHistory } from "./version-history";

const idleAction = vi.fn(async () => ({ status: "idle" as const }));

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
      setDefaultAction={idleAction}
      archiveAction={idleAction}
      restoreAction={idleAction}
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
      setDefaultAction={idleAction}
      archiveAction={idleAction}
      restoreAction={idleAction}
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

test("shows returned set-default errors beside the selected version form", () => {
  render(
    <VersionHistory
      characterId="char-1"
      slug="calm-guide"
      lifecycle="active"
      defaultVersionId={null}
      versions={[
        {
          id: "v2",
          versionNumber: 2,
          displayName: "Second",
          publishedAt: new Date("2026-10-08T01:02:03Z"),
        },
      ]}
      setDefaultAction={idleAction}
      archiveAction={idleAction}
      restoreAction={idleAction}
      defaultActionStates={{
        v2: {
          status: "error",
          message: "Default version could not be changed.",
        },
      }}
    />,
  );

  const defaultForm = screen
    .getByRole("button", { name: "Set version 2 as default" })
    .closest("form");

  expect(
    within(defaultForm as HTMLFormElement).getByRole("alert"),
  ).toHaveTextContent("Default version could not be changed.");
});

test("shows returned archive lifecycle errors in the archive form", () => {
  render(
    <VersionHistory
      characterId="char-1"
      slug="calm-guide"
      lifecycle="active"
      defaultVersionId={null}
      versions={[]}
      setDefaultAction={idleAction}
      archiveAction={idleAction}
      restoreAction={idleAction}
      archiveActionState={{
        status: "error",
        message: "Character could not be archived.",
      }}
    />,
  );

  const archiveForm = screen
    .getByRole("button", { name: "Archive character" })
    .closest("form");

  expect(
    within(archiveForm as HTMLFormElement).getByRole("alert"),
  ).toHaveTextContent("Character could not be archived.");
});

test("shows returned restore lifecycle errors in the restore form", () => {
  render(
    <VersionHistory
      characterId="char-1"
      slug="calm-guide"
      lifecycle="archived"
      defaultVersionId={null}
      versions={[]}
      setDefaultAction={idleAction}
      archiveAction={idleAction}
      restoreAction={idleAction}
      restoreActionState={{
        status: "error",
        message: "Character could not be restored.",
      }}
    />,
  );

  const restoreForm = screen
    .getByRole("button", { name: "Restore character" })
    .closest("form");

  expect(
    within(restoreForm as HTMLFormElement).getByRole("alert"),
  ).toHaveTextContent("Character could not be restored.");
});
