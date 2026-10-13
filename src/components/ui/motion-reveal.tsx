"use client";

import { motion, useReducedMotion } from "motion/react";
import { type ReactNode } from "react";
import { motionPresets, reducedMotionPresets } from "./motion-presets";

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

  return (
    <Component
      animate="visible"
      className={className}
      initial="hidden"
      variants={variants}
    >
      {children}
    </Component>
  );
}
