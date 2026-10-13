import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { memoryScreenFixture } from "@/test/memory-screen-fixture";
import { RelationshipMemoryScreen } from "./relationship-memory-screen";
import type { MemoryScreenActions } from "./relationship-memory-screen";
import type { MemoryAction } from "./memory-form-state";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
function actionSet() {
  const action = () =>
    vi.fn<MemoryAction>(async () => ({
      status: "success" as const,
      message: "Saved.",
    }));
  return {
    editMemory: action(),
    deleteMemory: action(),
    controls: action(),
    summary: action(),
    regenerate: action(),
    forget: action(),
    retry: action(),
  } satisfies MemoryScreenActions;
}
test("automatic active cards render only approved fields, evidence count and date", () => {
  const view = Object.assign(memoryScreenFixture(), {
    providerIdentity: "private-provider",
    candidates: "private-json",
    metadata: "private-operation",
  });
  render(<RelationshipMemoryScreen view={view} actions={actionSet()} />);
  expect(
    screen.getByText(/Automatic memories are active immediately/),
  ).toBeVisible();
  expect(screen.getByText(/2 supporting sources/)).toBeVisible();
  expect(screen.getAllByText(/2026-10-10/).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(
    /private-|confidence|test-model/,
  );
});
test("relationship overview summarizes recording, recall, saved items, and summary availability", () => {
  render(
    <RelationshipMemoryScreen
      view={memoryScreenFixture()}
      actions={actionSet()}
    />,
  );
  expect(
    screen.getByRole("heading", { level: 2, name: "Memory overview" }),
  ).toBeVisible();
  expect(screen.getByText("1 saved memory")).toBeVisible();
  expect(screen.getByText("Recording active")).toBeVisible();
  expect(screen.getByText("Recall active")).toBeVisible();
  expect(screen.getByText("Summary available")).toBeVisible();
});
test("zero saved memories render an explicit empty state and an absent summary state", () => {
  const view = memoryScreenFixture();
  view.items = [];
  view.summary = null;
  render(<RelationshipMemoryScreen view={view} actions={actionSet()} />);
  expect(
    screen.getByRole("heading", { level: 3, name: "No saved memories yet" }),
  ).toBeVisible();
  expect(screen.getByText("Summary not generated")).toBeVisible();
});
test("recording and recall remain explicit when both controls are disabled", () => {
  const view = memoryScreenFixture();
  view.settings.recordingEnabled = false;
  view.settings.usageEnabled = false;
  render(<RelationshipMemoryScreen view={view} actions={actionSet()} />);
  expect(screen.getByText("Recording stopped")).toBeVisible();
  expect(screen.getByText("Recall stopped")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Regenerate summary" }),
  ).toBeDisabled();
});
test("summary clear submits revision and clears a previous draft after success", async () => {
  const actions = actionSet();
  const view = memoryScreenFixture();
  const { rerender } = render(
    <RelationshipMemoryScreen view={view} actions={actions} />,
  );
  await userEvent.clear(screen.getByLabelText("Relationship summary"));
  await userEvent.type(
    screen.getByLabelText("Relationship summary"),
    "Unsaved draft",
  );
  await userEvent.click(screen.getByRole("button", { name: "Clear summary" }));
  await waitFor(() => expect(actions.summary).toHaveBeenCalled());
  const data = actions.summary.mock.calls[0][1] as FormData;
  expect(data.get("operation")).toBe("clear");
  expect(data.get("expectedRevision")).toBe("2");
  const next = memoryScreenFixture();
  next.summary = {
    ...view.summary!,
    content: "",
    origin: "user_edited",
    revision: 3,
  };
  next.summaryRevision = 3;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  expect(screen.getByLabelText("Relationship summary")).toHaveValue("");
});
test("forget removes stale summary drafts when refreshed state has no summary", async () => {
  const actions = actionSet();
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.type(
    screen.getByLabelText("Relationship summary"),
    "Private draft",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Forget character" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Forget character" });
  await userEvent.click(
    within(dialog).getByRole("checkbox", {
      name: "I want this character to forget me.",
    }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Forget character" }),
  );
  await waitFor(() => expect(actions.forget).toHaveBeenCalled());
  const next = memoryScreenFixture();
  next.items = [];
  next.summary = null;
  next.summaryRevision = 0;
  next.settings.revision = 2;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  expect(screen.getByLabelText("Relationship summary")).toHaveValue("");
  expect(screen.queryByText("Likes green tea.")).not.toBeInTheDocument();
});
test("delete, retry and regeneration submit scoped IDs or current revisions", async () => {
  const actions = actionSet();
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete memory" }));
  const deleteDialog = screen.getByRole("dialog", { name: "Delete memory" });
  await userEvent.click(
    within(deleteDialog).getByRole("checkbox", {
      name: "Permanently delete this memory.",
    }),
  );
  await userEvent.click(
    within(deleteDialog).getByRole("button", { name: "Delete memory" }),
  );
  await waitFor(() => expect(actions.deleteMemory).toHaveBeenCalled());
  expect(
    (actions.deleteMemory.mock.calls[0][1] as FormData).get("memoryId"),
  ).toBe("memory-1");
  expect(
    (actions.deleteMemory.mock.calls[0][1] as FormData).get("expectedRevision"),
  ).toBe("1");
  await userEvent.click(
    screen.getByRole("button", { name: "Retry extraction" }),
  );
  await waitFor(() => expect(actions.retry).toHaveBeenCalled());
  expect((actions.retry.mock.calls[0][1] as FormData).get("runId")).toBe(
    "run-1",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Regenerate summary" }),
  );
  await waitFor(() => expect(actions.regenerate).toHaveBeenCalled());
  expect(
    (actions.regenerate.mock.calls[0][1] as FormData).get("expectedRevision"),
  ).toBe("2");
});
test("pending edit prevents duplicate submission", async () => {
  const actions = actionSet();
  let finish!: (state: { status: "success"; message: string }) => void;
  actions.editMemory.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save memory" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByLabelText("Memory content")).toBeDisabled();
  finish({ status: "success", message: "Saved." });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save memory" })).toBeEnabled(),
  );
});
test("errors focus the accessible alert and keep the submitted content", async () => {
  const actions = actionSet();
  actions.editMemory.mockResolvedValue({
    status: "error",
    message: "The memory change is invalid.",
  });
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.clear(screen.getByLabelText("Memory content"));
  await userEvent.type(
    screen.getByLabelText("Memory content"),
    "Keep my draft",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save memory" }));
  expect(await screen.findByRole("alert")).toHaveFocus();
  expect(screen.getByLabelText("Memory content")).toHaveValue("Keep my draft");
});
test("summary edits carry explicit intent and conflicts preserve the draft with refreshed revision", async () => {
  const actions = actionSet();
  actions.summary.mockResolvedValue({
    status: "conflict",
    message: "Review the refreshed version.",
  });
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.clear(screen.getByLabelText("Relationship summary"));
  await userEvent.type(
    screen.getByLabelText("Relationship summary"),
    "My summary",
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: /explicitly want to remember this summary/,
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
  expect(await screen.findByRole("alert")).toHaveFocus();
  const submitted = actions.summary.mock.calls[0][1];
  expect(submitted.get("content")).toBe("My summary");
  expect(submitted.get("explicitIntent")).toBe("on");
  const next = memoryScreenFixture();
  next.summary = { ...next.summary!, content: "Server summary", revision: 4 };
  next.summaryRevision = 4;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  expect(screen.getByLabelText("Relationship summary")).toHaveValue(
    "My summary",
  );
  expect(screen.getByText("Server summary")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
  await waitFor(() => expect(actions.summary).toHaveBeenCalledTimes(2));
  expect(actions.summary.mock.calls[1][1].get("expectedRevision")).toBe("4");
});
test("usage can be stopped without stopping recording", async () => {
  const actions = actionSet();
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Stop using in chat" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Stop recording" }),
  ).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Save controls" }));
  await waitFor(() => expect(actions.controls).toHaveBeenCalled());
  expect(actions.controls.mock.calls[0][1].get("stopUsage")).toBe("on");
  expect(actions.controls.mock.calls[0][1].get("stopRecording")).toBeNull();
});
test("an ineligible needs-retry run has no manual retry action", () => {
  const view = memoryScreenFixture();
  view.extractions[0].canRetry = false;
  render(<RelationshipMemoryScreen view={view} actions={actionSet()} />);
  expect(screen.getByText("Needs retry")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Retry extraction" }),
  ).not.toBeInTheDocument();
});
test("failed retry keeps the synchronization alert visible and focused", async () => {
  const actions = actionSet();
  actions.retry.mockResolvedValue({
    status: "error",
    message: "Unable to retry extraction. Try again.",
  });
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Retry extraction" }),
  );
  expect(await screen.findByRole("alert")).toHaveFocus();
  expect(
    screen.getByText("Unable to retry extraction. Try again."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Retry extraction" }),
  ).toBeEnabled();
});
test("memory and summary content render as inert text rather than HTML", () => {
  const view = memoryScreenFixture();
  view.items[0].content = '<img src="x" onerror="alert(1)">';
  view.summary!.content = "<script>private()</script>";
  render(<RelationshipMemoryScreen view={view} actions={actionSet()} />);
  expect(
    screen.getByText('<img src="x" onerror="alert(1)">', { selector: "p" }),
  ).toBeVisible();
  expect(
    screen.getByText("<script>private()</script>", { selector: "p" }),
  ).toBeVisible();
  expect(document.querySelector("script, img")).toBeNull();
});
test("background refresh cannot silently advance dirty memory, summary or controls base revisions", async () => {
  const actions = actionSet();
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.type(screen.getByLabelText("Memory content"), " changed");
  await userEvent.type(
    screen.getByLabelText("Relationship summary"),
    " changed",
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: /explicitly want to remember this summary/,
    }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Stop recording" }),
  );
  const next = memoryScreenFixture();
  next.items[0].revision = 3;
  next.summaryRevision = 4;
  next.settings.revision = 5;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "Save memory" }));
  await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
  await userEvent.click(screen.getByRole("button", { name: "Save controls" }));
  await waitFor(() => expect(actions.controls).toHaveBeenCalled());
  expect(actions.editMemory.mock.calls[0][1].get("expectedRevision")).toBe("1");
  expect(actions.summary.mock.calls[0][1].get("expectedRevision")).toBe("2");
  expect(actions.controls.mock.calls[0][1].get("expectedRevision")).toBe("1");
});
test("background refresh preserves destructive delete confirmation base revision", async () => {
  const actions = actionSet();
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete memory" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Delete memory" })).getByRole(
      "checkbox",
      { name: "Permanently delete this memory." },
    ),
  );
  const next = memoryScreenFixture();
  next.items[0].revision = 3;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Delete memory" })).getByRole(
      "button",
      { name: "Delete memory" },
    ),
  );
  expect(actions.deleteMemory.mock.calls[0][1].get("expectedRevision")).toBe(
    "1",
  );
});
test("background refresh preserves forget confirmation base revision", async () => {
  const actions = actionSet();
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Forget character" }),
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Forget character" })).getByRole(
      "checkbox",
      { name: "I want this character to forget me." },
    ),
  );
  const next = memoryScreenFixture();
  next.settings.revision = 5;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Forget character" })).getByRole(
      "button",
      { name: "Forget character" },
    ),
  );
  await waitFor(() => expect(actions.forget).toHaveBeenCalled());
  expect(actions.forget.mock.calls[0][1].get("expectedRevision")).toBe("1");
});
test("recording and chat usage controls are independently submitted", async () => {
  const actions = actionSet() as unknown as {
    controls: ReturnType<typeof vi.fn>;
  };
  render(
    <RelationshipMemoryScreen
      view={memoryScreenFixture()}
      actions={actions as never}
    />,
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Stop recording" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Stop using in chat" }),
  ).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Save controls" }));
  await waitFor(() => expect(actions.controls).toHaveBeenCalled());
  const data = actions.controls.mock.calls[0][1] as FormData;
  expect(data.get("stopRecording")).toBe("on");
  expect(data.get("stopUsage")).toBeNull();
  expect(data.get("expectedRevision")).toBe("1");
});
test.each(["synced", "processing", "retrying", "needs_retry"] as const)(
  "status %s offers retry only for eligible needs_retry",
  (status) => {
    const view = memoryScreenFixture();
    view.extractions = [
      { id: "run-1", status, canRetry: status === "needs_retry" },
    ];
    render(<RelationshipMemoryScreen view={view} actions={actionSet()} />);
    expect(
      screen.getAllByText(
        {
          synced: "Synced",
          processing: "Processing",
          retrying: "Retrying",
          needs_retry: "Needs retry",
        }[status],
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Retry extraction" }) !== null,
    ).toBe(status === "needs_retry");
  },
);
test("conflict retains draft while refreshing authoritative content and revision", async () => {
  const actions = actionSet();
  actions.editMemory.mockResolvedValue({
    status: "conflict",
    message: "Your draft is preserved. Review the refreshed version.",
  });
  const view = memoryScreenFixture();
  const { rerender } = render(
    <RelationshipMemoryScreen view={view} actions={actions} />,
  );
  await userEvent.clear(screen.getByLabelText("Memory content"));
  await userEvent.type(
    screen.getByLabelText("Memory content"),
    "My authoritative edit",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save memory" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /draft is preserved/,
  );
  expect(refresh).toHaveBeenCalled();
  const next = memoryScreenFixture();
  next.items[0].content = "New server value";
  next.items[0].revision = 3;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  expect(screen.getByLabelText("Memory content")).toHaveValue(
    "My authoritative edit",
  );
  expect(screen.getByText("New server value")).toBeVisible();
  actions.editMemory.mockResolvedValue({
    status: "success",
    message: "Saved.",
  });
  await userEvent.click(screen.getByRole("button", { name: "Save memory" }));
  const data = actions.editMemory.mock.calls[1][1];
  expect(data.get("expectedRevision")).toBe("3");
});

test.each([
  { kind: "editMemory", button: "Save memory" },
  { kind: "deleteMemory", button: "Delete memory" },
  { kind: "controls", button: "Save controls" },
  { kind: "summary", button: "Save summary" },
  { kind: "summary", button: "Clear summary" },
  { kind: "regenerate", button: "Regenerate summary" },
  { kind: "forget", button: "Forget character" },
] as const)(
  "$kind adopts one conflict refresh, then fences two successive background changes",
  async ({ kind, button }) => {
    const actions = actionSet();
    actions[kind].mockResolvedValue({
      status: "conflict",
      message: "Review the refreshed version.",
    });
    const { rerender } = render(
      <RelationshipMemoryScreen
        view={memoryScreenFixture()}
        actions={actions}
      />,
    );
    await userEvent.type(screen.getByLabelText("Memory content"), " My draft");
    await userEvent.type(
      screen.getByLabelText("Relationship summary"),
      " My draft",
    );
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: /explicitly want to remember this summary/,
      }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Stop using in chat" }),
    );
    if (kind === "deleteMemory") {
      await userEvent.click(
        screen.getByRole("button", { name: "Delete memory" }),
      );
      await userEvent.click(
        within(screen.getByRole("dialog", { name: "Delete memory" })).getByRole(
          "checkbox",
          {
            name: "Permanently delete this memory.",
          },
        ),
      );
    }
    if (kind === "forget") {
      await userEvent.click(
        screen.getByRole("button", { name: "Forget character" }),
      );
      await userEvent.click(
        within(
          screen.getByRole("dialog", { name: "Forget character" }),
        ).getByRole("checkbox", {
          name: "I want this character to forget me.",
        }),
      );
    }
    if (kind === "deleteMemory") {
      await userEvent.click(
        within(screen.getByRole("dialog", { name: "Delete memory" })).getByRole(
          "button",
          { name: "Delete memory" },
        ),
      );
    } else if (kind === "forget") {
      await userEvent.click(
        within(
          screen.getByRole("dialog", { name: "Forget character" }),
        ).getByRole("button", {
          name: "Forget character",
        }),
      );
    } else {
      await userEvent.click(screen.getByRole("button", { name: button }));
    }
    expect(await screen.findByRole("alert")).toHaveFocus();
    for (const revision of [3, 4, 5]) {
      const next = memoryScreenFixture();
      next.items[0].revision = revision;
      next.items[0].content = `Server memory ${revision}`;
      next.summaryRevision = revision;
      next.summary = {
        ...next.summary!,
        revision,
        content: `Server summary ${revision}`,
      };
      next.settings.revision = revision;
      rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
    }
    expect(screen.getByLabelText("Memory content")).toHaveValue(
      "Likes green tea. My draft",
    );
    expect(screen.getByLabelText("Relationship summary")).toHaveValue(
      "We talk about tea. My draft",
    );
    if (kind === "deleteMemory") {
      const dialog = screen.getByRole("dialog", { name: "Delete memory" });
      const checkbox = within(dialog).getByRole("checkbox", {
        name: "Permanently delete this memory.",
      }) as HTMLInputElement;
      if (!checkbox.checked) {
        await userEvent.click(checkbox);
      }
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Delete memory" }),
      );
    } else if (kind === "forget") {
      const dialog = screen.getByRole("dialog", { name: "Forget character" });
      const checkbox = within(dialog).getByRole("checkbox", {
        name: "I want this character to forget me.",
      }) as HTMLInputElement;
      if (!checkbox.checked) {
        await userEvent.click(checkbox);
      }
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Forget character" }),
      );
    } else {
      await userEvent.click(screen.getByRole("button", { name: button }));
    }
    await waitFor(() => expect(actions[kind]).toHaveBeenCalledTimes(2));
    expect(actions[kind].mock.calls[1][1].get("expectedRevision")).toBe("3");
  },
);

test("dirty summary keeps its epoch when forget recreates the same numeric revision", async () => {
  const actions = actionSet();
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.type(
    screen.getByLabelText("Relationship summary"),
    " old draft",
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: /explicitly want to remember this summary/,
    }),
  );
  const recreated = { ...memoryScreenFixture(), summaryEpoch: 1 };
  rerender(<RelationshipMemoryScreen view={recreated} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
  await waitFor(() => expect(actions.summary).toHaveBeenCalled());
  expect(actions.summary.mock.calls[0][1].get("expectedMemoryEpoch")).toBe("0");
});

test("forget clears a draft even when the absent summary revision stays zero", async () => {
  const initial = memoryScreenFixture();
  initial.summary = null;
  initial.summaryRevision = 0;
  const { rerender } = render(
    <RelationshipMemoryScreen view={initial} actions={actionSet()} />,
  );
  await userEvent.type(
    screen.getByLabelText("Relationship summary"),
    "Forgotten draft",
  );
  const forgotten = { ...initial, summaryEpoch: 1 };
  rerender(<RelationshipMemoryScreen view={forgotten} actions={actionSet()} />);
  expect(screen.getByLabelText("Relationship summary")).toHaveValue("");
});

test.each(["Save summary", "Clear summary", "Regenerate summary"])(
  "%s conflict adopts one epoch, then freezes across two more epochs at the same revision",
  async (button) => {
    const actions = actionSet();
    const action =
      button === "Regenerate summary" ? actions.regenerate : actions.summary;
    action.mockResolvedValue({
      status: "conflict",
      message: "Review the refreshed version.",
    });
    const { rerender } = render(
      <RelationshipMemoryScreen
        view={memoryScreenFixture()}
        actions={actions}
      />,
    );
    await userEvent.type(
      screen.getByLabelText("Relationship summary"),
      " My draft",
    );
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: /explicitly want to remember this summary/,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: button }));
    await screen.findByRole("alert");
    for (const epoch of [1, 2, 3]) {
      rerender(
        <RelationshipMemoryScreen
          view={{ ...memoryScreenFixture(), summaryEpoch: epoch }}
          actions={actions}
        />,
      );
    }
    expect(screen.getByLabelText("Relationship summary")).toHaveValue(
      "We talk about tea. My draft",
    );
    await userEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1][1].get("expectedMemoryEpoch")).toBe("1");
    expect(action.mock.calls[1][1].get("expectedRevision")).toBe("2");
  },
);
test("forget section explains its consequences and opens a confirmation dialog", async () => {
  const actions = actionSet();
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  const region = screen.getByRole("region", { name: "Forget character" });
  expect(region).toHaveTextContent(
    "Removes memory, evidence, and relationship summary. Cancels old work and starts a new memory epoch. Your conversation transcripts are kept.",
  );
  await userEvent.click(
    within(region).getByRole("button", { name: "Forget character" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Forget character" });
  expect(
    within(dialog).getByRole("checkbox", {
      name: "I want this character to forget me.",
    }),
  ).toBeRequired();
  expect(
    within(dialog).getByRole("button", { name: "Forget character" }),
  ).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("checkbox"));
  expect(
    within(dialog).getByRole("button", { name: "Forget character" }),
  ).toBeEnabled();
});
test("forget dialog stays open while a destructive action is pending", async () => {
  const actions = actionSet();
  let finish!: (state: { status: "success"; message: string }) => void;
  actions.forget.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Forget character" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Forget character" });
  await userEvent.click(
    within(dialog).getByRole("checkbox", {
      name: "I want this character to forget me.",
    }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Forget character" }),
  );
  expect(
    within(dialog).getByRole("button", { name: "Forgetting…" }),
  ).toBeDisabled();
  fireEvent.click(dialog);
  expect(
    screen.getByRole("dialog", { name: "Forget character" }),
  ).toBeVisible();
  finish({ status: "success", message: "Saved." });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Forget character" }),
    ).not.toBeInTheDocument(),
  );
});
test("sensitive manual edits require explicit intent; edit/delete/summary/retry forms are accessible", async () => {
  render(
    <RelationshipMemoryScreen
      view={memoryScreenFixture()}
      actions={actionSet()}
    />,
  );
  expect(
    screen.getAllByRole("checkbox", { name: /explicitly want to remember/ }),
  ).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Delete memory" }));
  const dialog = screen.getByRole("dialog", { name: "Delete memory" });
  expect(
    within(dialog).getByRole("button", { name: "Delete memory" }),
  ).toBeDisabled();
  await userEvent.click(
    within(dialog).getByRole("checkbox", {
      name: "Permanently delete this memory.",
    }),
  );
  expect(
    within(dialog).getByRole("button", { name: "Delete memory" }),
  ).toBeEnabled();
  expect(screen.getByLabelText("Relationship summary")).toHaveValue(
    "We talk about tea.",
  );
  expect(screen.getByRole("button", { name: "Clear summary" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Regenerate summary" }),
  ).toBeEnabled();
});
