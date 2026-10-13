"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import {
  motionPresets,
  reducedMotionPresets,
} from "@/components/ui/motion-presets";
import type { ChatClientMessage } from "./chat-message";

export function messageMotionKey(message: Pick<ChatClientMessage, "id">) {
  return message.id;
}

export function ChatMessageMotion({
  children,
  entering,
  message,
}: {
  children: ReactNode;
  entering: boolean;
  message: ChatClientMessage;
}) {
  const prefersReducedMotion = useReducedMotion();
  const presets = prefersReducedMotion ? reducedMotionPresets : motionPresets;

  return (
    <motion.li
      animate="visible"
      className={cx(
        "chat-message",
        `chat-message--${message.role}`,
        message.kind !== message.role && `chat-message--${message.kind}`,
      )}
      data-motion={
        entering ? (prefersReducedMotion ? "reduced" : "standard") : undefined
      }
      data-status={message.kind === "generated" ? message.status : undefined}
      initial={false}
      variants={presets.messageEnter}
    >
      {children}
    </motion.li>
  );
}
