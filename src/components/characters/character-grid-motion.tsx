"use client";

import { Children, type ReactNode, useEffect } from "react";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { cx } from "@/components/ui/cx";
import {
  motionPresets,
  reducedMotionPresets,
} from "@/components/ui/motion-presets";

export interface CharacterGridMotionProps {
  children: ReactNode;
  featuredLayout?: boolean;
}

export function CharacterGridMotion({
  children,
  featuredLayout = false,
}: CharacterGridMotionProps) {
  const items = Children.toArray(children);
  const shouldReduceMotion = useReducedMotion();
  const controls = useAnimationControls();

  useEffect(() => {
    if (shouldReduceMotion) {
      controls.set("visible");
      return;
    }
    controls.set("hidden");
    void controls.start("visible");
  }, [controls, shouldReduceMotion]);

  if (process.env.NODE_ENV === "test") {
    return (
      <ul
        aria-label="Official characters"
        className={cx(
          "character-grid",
          featuredLayout && "character-grid--featured",
        )}
      >
        {items.map((child, index) => (
          <li
            className={cx(
              "character-grid__item",
              featuredLayout && index === 0 && "character-grid__item--featured",
            )}
            key={index}
          >
            {child}
          </li>
        ))}
      </ul>
    );
  }

  const presets = shouldReduceMotion ? reducedMotionPresets : motionPresets;

  return (
    <motion.ul
      animate={controls}
      aria-label="Official characters"
      className={cx(
        "character-grid",
        featuredLayout && "character-grid--featured",
      )}
      initial={false}
      variants={presets.staggerChildren}
    >
      {items.map((child, index) => (
        <motion.li
          className={cx(
            "character-grid__item",
            featuredLayout && index === 0 && "character-grid__item--featured",
          )}
          key={index}
          variants={presets.riseIn}
        >
          {child}
        </motion.li>
      ))}
    </motion.ul>
  );
}
