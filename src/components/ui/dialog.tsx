"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "./cx";

export interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export interface DialogFrameProps extends DialogProps {
  side?: "left" | "right" | "bottom";
  variant?: "dialog" | "drawer";
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

function focusFirstElement(
  dialog: HTMLDialogElement,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const focusTarget =
    initialFocusRef?.current ?? getFocusableElements(dialog)[0] ?? dialog;

  focusTarget.focus();
}

function trapFocus(dialog: HTMLDialogElement, event: KeyboardEvent) {
  const focusableElements = getFocusableElements(dialog);

  if (!focusableElements.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);

    update();

    mediaQuery.addEventListener?.("change", update);

    return () => {
      mediaQuery.removeEventListener?.("change", update);
    };
  }, []);

  return reducedMotion;
}

export function DialogFrame({
  children,
  description,
  initialFocusRef,
  onOpenChange,
  open,
  side = "right",
  title,
  variant = "dialog",
}: DialogFrameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reducedMotion = useReducedMotionPreference();
  const latestProps = useRef({ initialFocusRef, onOpenChange });

  useLayoutEffect(() => {
    latestProps.current = { initialFocusRef, onOpenChange };
  }, [initialFocusRef, onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.open = true;
        dialog.setAttribute("open", "");
      }
    }

    focusFirstElement(dialog, latestProps.current.initialFocusRef);

    const requestClose = () => latestProps.current.onOpenChange(false);

    const viewport = window.visualViewport;
    const updateViewport = () => {
      dialog.style.setProperty(
        "--overlay-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      dialog.style.setProperty(
        "--overlay-viewport-width",
        `${viewport?.width ?? window.innerWidth}px`,
      );
      dialog.style.setProperty(
        "--overlay-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
      dialog.style.setProperty(
        "--overlay-viewport-left",
        `${viewport?.offsetLeft ?? 0}px`,
      );
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);

    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key === "Tab") {
        trapFocus(dialog, event);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        requestClose();
      }
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("click", handleClick);

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("click", handleClick);
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);

      if (dialog.open) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.open = false;
          dialog.removeAttribute("open");
        }
      }

      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;

      if (previouslyFocusedRef.current?.isConnected) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      className={cx(
        "ui-overlay",
        variant === "drawer" ? "ui-drawer" : "ui-dialog",
      )}
      data-motion={reducedMotion ? "reduced" : "standard"}
      data-side={variant === "drawer" ? side : undefined}
      ref={dialogRef}
      role="dialog"
    >
      <div
        className={cx(
          "ui-overlay__panel",
          variant === "drawer" ? "ui-drawer__panel" : "ui-dialog__panel",
        )}
        role="document"
      >
        <div className="ui-overlay__header">
          <h2 className="ui-overlay__title" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="ui-overlay__description" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </div>
        <div className="ui-overlay__body">{children}</div>
      </div>
    </dialog>
  );
}

export function Dialog(props: DialogProps) {
  return <DialogFrame {...props} variant="dialog" />;
}
