import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { type RefObject, useRef, useState } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Dialog } from "./dialog";
import { Drawer } from "./drawer";

beforeAll(() => {
  const prototype = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };

  if (!prototype.showModal) {
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
        this.setAttribute("open", "");
      },
    });
  }

  if (!prototype.close) {
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.removeAttribute("open");
      },
    });
  }
});

afterEach(() => {
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  vi.unstubAllGlobals();
});

function HistoryDialogHarness({
  preventDismissal = false,
}: {
  preventDismissal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open history
      </button>
      <Dialog
        description="Review archived conversations."
        initialFocusRef={initialFocusRef}
        onOpenChange={(nextOpen) => {
          if (preventDismissal && !nextOpen) {
            return;
          }

          setOpen(nextOpen);
        }}
        open={open}
        title="Conversation history"
      >
        <button ref={initialFocusRef} type="button">
          Newest first
        </button>
        <button type="button">Older first</button>
        <button type="button">Delete conversation</button>
      </Dialog>
    </>
  );
}

function UnmountableDialogHarness() {
  const [mounted, setMounted] = useState(true);
  const [open, setOpen] = useState(false);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open history
      </button>
      <button onClick={() => setMounted(false)} type="button">
        Remove overlay
      </button>
      {mounted ? (
        <Dialog
          initialFocusRef={initialFocusRef}
          onOpenChange={setOpen}
          open={open}
          title="Conversation history"
        >
          <button ref={initialFocusRef} type="button">
            Newest first
          </button>
        </Dialog>
      ) : null}
    </>
  );
}

function NavigationDrawerHarness({
  initialFocusRef,
}: {
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Drawer
      description="Move between the current product areas."
      initialFocusRef={initialFocusRef}
      onOpenChange={() => {}}
      open
      side="bottom"
      title="Navigation"
    >
      <Link href="/app">Conversations</Link>
      <Link href="/app/memories">Memories</Link>
      <Link href="/account">Account</Link>
    </Drawer>
  );
}

test("dialog opens with an accessible name, traps focus, closes on Escape, and restores the trigger focus", async () => {
  const user = userEvent.setup();

  render(<HistoryDialogHarness />);

  await user.click(screen.getByRole("button", { name: "Open history" }));

  const dialog = screen.getByRole("dialog", { name: "Conversation history" });

  expect(dialog).toBeVisible();
  expect(dialog).toContainElement(
    document.activeElement as HTMLElement | SVGElement | null,
  );
  expect(screen.getByRole("button", { name: "Newest first" })).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");

  await user.tab();
  expect(screen.getByRole("button", { name: "Older first" })).toHaveFocus();
  await user.tab();
  expect(
    screen.getByRole("button", { name: "Delete conversation" }),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Newest first" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(
    screen.getByRole("button", { name: "Delete conversation" }),
  ).toHaveFocus();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open history" })).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
});

test("dialog closes on backdrop interaction", async () => {
  const user = userEvent.setup();

  render(<HistoryDialogHarness />);

  await user.click(screen.getByRole("button", { name: "Open history" }));

  fireEvent.click(screen.getByRole("dialog", { name: "Conversation history" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("pending destructive work can prevent Escape and backdrop dismissal", async () => {
  const user = userEvent.setup();

  render(<HistoryDialogHarness preventDismissal />);

  await user.click(screen.getByRole("button", { name: "Open history" }));

  const dialog = screen.getByRole("dialog", { name: "Conversation history" });

  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible();

  fireEvent.click(dialog);
  expect(dialog).toBeVisible();
});

test("open overlays release scroll lock when they unmount", async () => {
  const user = userEvent.setup();

  render(<UnmountableDialogHarness />);

  await user.click(screen.getByRole("button", { name: "Open history" }));
  expect(screen.getByRole("dialog", { name: "Conversation history" })).toBeVisible();
  expect(document.body.style.overflow).toBe("hidden");

  await user.click(screen.getByRole("button", { name: "Remove overlay" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");
});

test("drawers expose mobile placement and reduced-motion state", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    addEventListener: vi.fn(),
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    removeEventListener: vi.fn(),
  })));

  const initialFocusRef = { current: null } as RefObject<HTMLElement | null>;

  render(<NavigationDrawerHarness initialFocusRef={initialFocusRef} />);

  expect(screen.getByRole("dialog", { name: "Navigation" })).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  expect(screen.getByRole("dialog", { name: "Navigation" })).toHaveAttribute(
    "data-side",
    "bottom",
  );
});
