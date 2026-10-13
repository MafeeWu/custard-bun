"use client";

import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { motionPresets, reducedMotionPresets } from "./motion-presets";
import { cx } from "./cx";

export interface MotionRevealProps {
  preset: "riseIn" | "staggerChildren" | "messageEnter" | "statusTransition";
  as?: "div" | "section" | "li";
  children: ReactNode;
  className?: string;
}

const motionElements = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
} as const;

export function MotionReveal({
  as = "div",
  children,
  className,
  preset,
}: MotionRevealProps) {
  const shouldReduceMotion = useReducedMotion();
  const variants = (shouldReduceMotion ? reducedMotionPresets : motionPresets)[
    preset
  ];
  const Component = motionElements[as];
  const controls = useAnimationControls();

  useEffect(() => {
    if (shouldReduceMotion) {
      controls.set("visible");
      return;
    }
    controls.set("hidden");
    void controls.start("visible");
  }, [controls, preset, shouldReduceMotion]);

  return (
    <Component
      animate={controls}
      className={cx("ui-motion-reveal", className)}
      initial={false}
      variants={variants}
    >
      {children}
    </Component>
  );
}
