"use client";

import { DialogFrame, type DialogProps } from "./dialog";

export interface DrawerProps extends DialogProps {
  side?: "left" | "right" | "bottom";
}

export function Drawer({ side = "right", ...props }: DrawerProps) {
  return <DialogFrame {...props} side={side} variant="drawer" />;
}
