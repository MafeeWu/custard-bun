import { render, screen, waitFor, within } from "@testing-library/react";
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
    screen.getByRole("checkbox", {
      name: "I want this character to forget me.",
    }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Forget character" }),
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
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Permanently delete this memory." }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete memory" }));
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
test("background refresh preserves destructive confirmation base revisions", async () => {
  const actions = actionSet();
  const { rerender } = render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Permanently delete this memory." }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: "I want this character to forget me.",
    }),
  );
  const next = memoryScreenFixture();
  next.items[0].revision = 3;
  next.settings.revision = 5;
  rerender(<RelationshipMemoryScreen view={next} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete memory" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Forget character" }),
  );
  await waitFor(() => expect(actions.forget).toHaveBeenCalled());
  expect(actions.deleteMemory.mock.calls[0][1].get("expectedRevision")).toBe(
    "1",
  );
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
  const actions = actionSet() as unknown as {
    editMemory: ReturnType<typeof vi.fn>;
  };
  actions.editMemory.mockResolvedValue({
    status: "conflict",
    message: "Your draft is preserved. Review the refreshed version.",
  });
  const view = memoryScreenFixture();
  const { rerender } = render(
    <RelationshipMemoryScreen view={view} actions={actions as never} />,
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
  rerender(<RelationshipMemoryScreen view={next} actions={actions as never} />);
  expect(screen.getByLabelText("Memory content")).toHaveValue(
    "My authoritative edit",
  );
  expect(screen.getByText("New server value")).toBeVisible();
  actions.editMemory.mockResolvedValue({
    status: "success",
    message: "Saved.",
  });
  await userEvent.click(screen.getByRole("button", { name: "Save memory" }));
  const data = actions.editMemory.mock.calls[1][1] as FormData;
  expect(data.get("expectedRevision")).toBe("3");
});
test("forget confirmation distinguishes transcript retention and epoch cancellation", async () => {
  const actions = actionSet();
  render(
    <RelationshipMemoryScreen view={memoryScreenFixture()} actions={actions} />,
  );
  const region = screen.getByRole("region", { name: "Forget character" });
  expect(region).toHaveTextContent(
    "Removes memory, evidence, and relationship summary. Cancels old work and starts a new memory epoch. Your conversation transcripts are kept.",
  );
  expect(
    within(region).getByRole("checkbox", {
      name: "I want this character to forget me.",
    }),
  ).toBeRequired();
  expect(
    within(region).getByRole("button", { name: "Forget character" }),
  ).toBeDisabled();
  await userEvent.click(within(region).getByRole("checkbox"));
  expect(
    within(region).getByRole("button", { name: "Forget character" }),
  ).toBeEnabled();
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
  expect(screen.getByRole("button", { name: "Delete memory" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Permanently delete this memory." }),
  );
  expect(screen.getByRole("button", { name: "Delete memory" })).toBeEnabled();
  expect(screen.getByLabelText("Relationship summary")).toHaveValue(
    "We talk about tea.",
  );
  expect(screen.getByRole("button", { name: "Clear summary" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Regenerate summary" }),
  ).toBeEnabled();
});
