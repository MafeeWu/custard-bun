import { type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type SurfaceTone = "default" | "raised" | "subtle" | "accent";
export type SurfacePadding = "sm" | "md" | "lg";
export type SurfaceElement = "div" | "section" | "article";

export interface SurfaceProps extends HTMLAttributes<
  HTMLDivElement | HTMLElement
> {
  as?: SurfaceElement;
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  children: ReactNode;
}

const toneClassNames: Record<SurfaceTone, string> = {
  default: "ui-surface--default",
  raised: "ui-surface--raised",
  subtle: "ui-surface--subtle",
  accent: "ui-surface--accent",
};

const paddingClassNames: Record<SurfacePadding, string> = {
  sm: "ui-surface--sm",
  md: "ui-surface--md",
  lg: "ui-surface--lg",
};

export function Surface({
  as = "div",
  children,
  className,
  padding = "md",
  tone = "default",
  ...props
}: SurfaceProps) {
  const Component = as;

  return (
    <Component
      {...props}
      className={cx(
        "ui-surface",
        toneClassNames[tone],
        paddingClassNames[padding],
        className,
      )}
    >
      {children}
    </Component>
  );
}
