"use client";

import { CaretDown } from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";
import { cx } from "./cx";

export interface DisclosureProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Disclosure({
  children,
  defaultOpen = false,
  title,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="ui-disclosure">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={cx("ui-button", "ui-button--quiet", "ui-button--sm")}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden="true" className="ui-disclosure__icon">
          <CaretDown size={18} weight="bold" />
        </span>
        <span className="ui-button__label">{title}</span>
      </button>
      <div
        className="ui-disclosure__panel"
        hidden={!open}
        id={panelId}
        role="region"
      >
        {children}
      </div>
    </div>
  );
}
