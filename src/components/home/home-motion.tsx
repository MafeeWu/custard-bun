"use client";

import { type ReactNode } from "react";
import {
  MotionReveal,
  type MotionRevealProps,
} from "@/components/ui/motion-reveal";
import { cx } from "@/components/ui/cx";

export type HomeMotionId =
  | "hero-copy"
  | "hero-stage"
  | "preview-feature"
  | "preview-list"
  | "privacy"
  | "continuity"
  | "final-cta";

export interface HomeMotionProps {
  as?: MotionRevealProps["as"];
  children: ReactNode;
  className?: string;
  motionId: HomeMotionId;
  preset: MotionRevealProps["preset"];
}

export function HomeMotion({
  as,
  children,
  className,
  motionId,
  preset,
}: HomeMotionProps) {
  if (process.env.NODE_ENV === "test") {
    return (
      <div className={cx("home-motion", className)}>
        <div className="home-motion__content" data-home-motion={motionId}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <MotionReveal
      as={as}
      className={cx("home-motion", className)}
      preset={preset}
    >
      <div className="home-motion__content" data-home-motion={motionId}>
        {children}
      </div>
    </MotionReveal>
  );
}
