import { type HTMLAttributes } from "react";
import { cx } from "./cx";

export type SkeletonShape = "line" | "block" | "avatar";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shape?: SkeletonShape;
}

const shapeClassNames: Record<SkeletonShape, string> = {
  line: "ui-skeleton--line",
  block: "ui-skeleton--block",
  avatar: "ui-skeleton--avatar",
};

export function Skeleton({
  className,
  shape = "line",
  ...props
}: SkeletonProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cx("ui-skeleton", shapeClassNames[shape], className)}
      data-testid="ui-skeleton"
    />
  );
}
