import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewCharacterPage from "@/app/admin/characters/new/page";
import {
  publishCharacterDraftAction,
  saveCharacterDraftAction,
} from "@/app/admin/characters/actions";
import { DraftConflictError } from "@/server/characters/character-errors";
import { OFFICIAL_CHARACTER_SEEDS } from "@/server/characters/seed-definitions";
import { CharacterEditor } from "./character-editor";

const service = vi.hoisted(() => ({
  createCharacter: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
}));

vi.mock("@/server/admin/require-admin", () => ({
  requireAdmin: async () => ({
    userId: "administrator",
    label: "admin@example.com",
    operationId: "editor-submit",
  }),
}));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/characters/character-service", () => ({
  createCharacterService: () => service,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const content = {
  ...OFFICIAL_CHARACTER_SEEDS[0].content,
  exampleConversations: [{ user: "First user", assistant: "First assistant" }],
};
const saveAction = saveCharacterDraftAction.bind(null, "char-1");
const publishAction = publishCharacterDraftAction.bind(
  null,
  "char-1",
  "calm-guide",
);
const props = {
  mode: "edit" as const,
  characterId: "char-1",
  slug: "calm-guide",
  draftRevision: 3,
  content,
  action: saveAction,
  publishAction,
};

function editorForm() {
  return screen.getByRole("form", {
    name: "Character editor",
  }) as HTMLFormElement;
}

function submittedValues() {
  return [...new FormData(editorForm()).entries()];
}

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillEveryField(mode: "create" | "edit") {
  if (mode === "create") change("Slug", "my-new-character");
  const values = {
    "Display name": "My edited character",
    "Avatar path": "/characters/calm-listener.svg",
    "Short description": "  Keep my short description.  ",
    "Long description": "Keep my long description and unsaved detail.",
    "Personality principles": "My first principle.\n\nMy second principle.",
    "Speaking style": "My carefully written style.",
    "Response rhythm": "A thoughtful pause and a question.",
    "Relationship boundaries":
      "Keep the first boundary.\nKeep the second boundary.",
    "Opening message": "My new opening.",
    "Example user 1": "My edited user message.",
    "Example assistant 1": "My edited paired reply.",
    Temperature: "0.42",
    "Top P": "0.8",
    "Max output tokens": "1100",
    "Safety additions": "Keep this safety addition.\nAnd this one.",
  };
  for (const [label, value] of Object.entries(values)) change(label, value);
}

beforeEach(() => {
  for (const method of Object.values(service)) method.mockReset();
  service.saveDraft.mockResolvedValue({ draftRevision: 4 });
  service.publishDraft.mockResolvedValue({
    versionId: "version-1",
    versionNumber: 1,
    draftRevision: 5,
  });
});

describe("the editor's content/revision snapshot", () => {
  it("submits dirty content against its original revision after newer server props arrive", async () => {
    const user = userEvent.setup();
    service.saveDraft.mockRejectedValue(new DraftConflictError());
    const view = await render(<CharacterEditor {...props} />);
    change("Display name", "Unsaved local name");

    view.rerender(
      <CharacterEditor
        {...props}
        draftRevision={4}
        content={{ ...content, displayName: "Other administrator's new name" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reload the page",
    );
    expect(service.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 3,
        content: expect.objectContaining({ displayName: "Unsaved local name" }),
      }),
    );
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "Unsaved local name",
    );
    expect(new FormData(editorForm()).get("expectedRevision")).toBe("3");
  });

  it("advances the base revision only on confirmed saves while retaining editable content", async () => {
    const user = userEvent.setup();
    service.saveDraft
      .mockResolvedValueOnce({ draftRevision: 4 })
      .mockResolvedValueOnce({ draftRevision: 5 });
    await render(<CharacterEditor {...props} />);
    change("Display name", "Saved local name");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved draft revision 4.",
    );
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "Saved local name",
    );
    expect(new FormData(editorForm()).get("expectedRevision")).toBe("4");

    change("Opening message", "A later edit");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved draft revision 5.",
    );
    expect(service.saveDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 4,
        content: expect.objectContaining({
          displayName: "Saved local name",
          openingMessage: "A later edit",
        }),
      }),
    );
  });

  it("keeps save and publish on the confirmed base revision without relying on a prop refresh", async () => {
    const user = userEvent.setup();
    await render(<CharacterEditor {...props} />);
    change("Display name", "Publishable name");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Saved draft revision 4.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Publish draft" }));
    expect(await screen.findByText("Published version 1.")).toBeVisible();

    expect(service.publishDraft).toHaveBeenCalledWith({
      characterId: "char-1",
      expectedRevision: 4,
    });
    expect(new FormData(editorForm()).get("expectedRevision")).toBe("5");
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "Publishable name",
    );
  });
});

describe("failed submissions preserve administrator input", () => {
  it.each([
    { mode: "edit" as const, failure: "validation" },
    { mode: "edit" as const, failure: "database" },
    { mode: "edit" as const, failure: "conflict" },
    { mode: "create" as const, failure: "validation" },
    { mode: "create" as const, failure: "database" },
  ])(
    "retains every submitted $mode field after a $failure error",
    async ({ mode, failure }) => {
      const user = userEvent.setup();
      const mutation =
        mode === "create" ? service.createCharacter : service.saveDraft;
      if (failure === "database")
        mutation.mockRejectedValue(new Error("database unavailable"));
      if (failure === "conflict")
        mutation.mockRejectedValue(new DraftConflictError());
      await render(
        mode === "create" ? (
          <NewCharacterPage />
        ) : (
          <CharacterEditor {...props} />
        ),
      );
      fillEveryField(mode);
      if (failure === "validation") change("Temperature", "2.5");
      const submitted = submittedValues();

      await user.click(
        screen.getByRole("button", {
          name: mode === "create" ? "Create draft" : "Save draft",
        }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        failure === "validation"
          ? "Check the highlighted fields"
          : failure === "conflict"
            ? "Reload the page"
            : "Unable to update the character",
      );
      expect(submittedValues()).toEqual(submitted);
      if (failure === "validation") expect(mutation).not.toHaveBeenCalled();
      else expect(mutation).toHaveBeenCalledOnce();
    },
  );
});

describe("bounded paired example controls", () => {
  it("adds and removes pairs and submits each remaining user with its own assistant", async () => {
    const user = userEvent.setup();
    await render(<CharacterEditor {...props} />);
    const add = screen.getByRole("button", {
      name: "Add example conversation",
    });

    for (let index = 2; index <= 3; index++) {
      await user.click(add);
      change(`Example user ${index}`, `User ${index}`);
      change(`Example assistant ${index}`, `Assistant ${index}`);
    }
    await user.click(screen.getByRole("button", { name: "Remove example 2" }));
    expect(screen.getByLabelText("Example user 2")).toHaveValue("User 3");
    expect(screen.getByLabelText("Example assistant 2")).toHaveValue(
      "Assistant 3",
    );

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Saved draft revision 4.")).toBeVisible();
    expect(service.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          exampleConversations: [
            { user: "First user", assistant: "First assistant" },
            { user: "User 3", assistant: "Assistant 3" },
          ],
        }),
      }),
    );
    expect(new FormData(editorForm()).getAll("exampleUser")).toEqual([
      "First user",
      "User 3",
    ]);
    expect(new FormData(editorForm()).getAll("exampleAssistant")).toEqual([
      "First assistant",
      "Assistant 3",
    ]);
  });

  it("enforces the accessible minimum of one and maximum of six paired examples", async () => {
    const user = userEvent.setup();
    await render(<CharacterEditor {...props} />);
    const examples = within(
      screen.getByRole("group", { name: "Example conversations" }),
    );
    const add = examples.getByRole("button", {
      name: "Add example conversation",
    });
    expect(
      examples.getByRole("button", { name: "Remove example 1" }),
    ).toBeDisabled();

    for (let index = 2; index <= 6; index++) await user.click(add);
    expect(examples.getAllByLabelText(/^Example user/)).toHaveLength(6);
    expect(examples.getAllByLabelText(/^Example assistant/)).toHaveLength(6);
    expect(add).toBeDisabled();
    await user.click(add);
    expect(examples.getAllByLabelText(/^Example user/)).toHaveLength(6);

    for (let index = 6; index >= 2; index--) {
      await user.click(
        examples.getByRole("button", { name: `Remove example ${index}` }),
      );
    }
    const removeLast = examples.getByRole("button", {
      name: "Remove example 1",
    });
    expect(removeLast).toBeDisabled();
    await user.click(removeLast);
    expect(examples.getAllByLabelText(/^Example user/)).toHaveLength(1);
    expect(examples.getAllByLabelText(/^Example assistant/)).toHaveLength(1);
    expect(add).toBeEnabled();
  });

  it("retains a newly added half-filled pair when real form validation fails", async () => {
    const user = userEvent.setup();
    await render(<CharacterEditor {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Add example conversation" }),
    );
    change("Example user 2", "Do not lose this unfinished example");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the highlighted fields",
    );
    expect(
      screen.getByText("Example assistant response is required."),
    ).toBeVisible();
    expect(screen.getByLabelText("Example user 2")).toHaveValue(
      "Do not lose this unfinished example",
    );
    expect(screen.getByLabelText("Example assistant 2")).toHaveValue("");
    expect(service.saveDraft).not.toHaveBeenCalled();
  });
});
