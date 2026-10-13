"use client";

import { type MotionProps, type Variants } from "motion/react";

export interface MotionPresetCollection {
  riseIn: Variants;
  staggerChildren: Variants;
  messageEnter: Variants;
  statusTransition: Variants;
  cardHover: MotionProps;
}

const easeStandard = [0.2, 0.8, 0.2, 1] as const;

export const motionPresets: MotionPresetCollection = {
  riseIn: {
    hidden: { opacity: 0, y: 18 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.24, ease: easeStandard },
    },
  },
  staggerChildren: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.04,
      },
    },
  },
  messageEnter: {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.18, ease: easeStandard },
    },
  },
  statusTransition: {
    hidden: { opacity: 0, scale: 0.98 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.16, ease: easeStandard },
    },
    exit: {
      opacity: 0,
      scale: 0.98,
      transition: { duration: 0.12, ease: easeStandard },
    },
  },
  cardHover: {
    whileHover: { y: -2, scale: 1.01 },
    whileTap: { scale: 0.99 },
    transition: { duration: 0.18, ease: easeStandard },
  },
};

export const reducedMotionPresets: MotionPresetCollection = {
  riseIn: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.01 },
    },
  },
  staggerChildren: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0,
        delayChildren: 0,
      },
    },
  },
  messageEnter: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.01 },
    },
  },
  statusTransition: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.01 },
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.01 },
    },
  },
  cardHover: {
    whileHover: { opacity: 1 },
    whileTap: { opacity: 1 },
    transition: { duration: 0.01 },
  },
};
