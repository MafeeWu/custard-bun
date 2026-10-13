"use client";

import { List, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Drawer } from "@/components/ui/drawer";

export function MobileNavigation({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <IconButton
        icon={<List size={20} weight="bold" />}
        label="Open navigation"
        onClick={() => setOpen(true)}
        tone="secondary"
      />
      <Drawer
        initialFocusRef={closeButtonRef}
        onOpenChange={setOpen}
        open={open}
        side="bottom"
        title={title}
      >
        <div className="shell-mobile-navigation">
          <div className="shell-mobile-navigation__header">
            <p className="shell-mobile-navigation__title">{title}</p>
            <IconButton
              icon={<X size={20} weight="bold" />}
              label="Close navigation"
              onClick={() => setOpen(false)}
              ref={closeButtonRef}
              tone="quiet"
            />
          </div>
          <div className="shell-mobile-navigation__content">{children}</div>
        </div>
      </Drawer>
    </>
  );
}
