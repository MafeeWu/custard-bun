import { jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

const adminAuditActionValues = [
  "character.create",
  "character.draft.save",
  "character.version.publish",
  "character.default.change",
  "character.archive",
  "character.restore",
  "user.disable",
  "user.restore",
  "chat.settings.update",
  "chat.settings.reset",
  "user.chat_quota.update",
  "user.chat_quota.clear",
  "memory.settings.update",
  "memory.settings.reset",
  "memory.operation.retry",
  "memory.character_forget",
] as const;

type AdminAuditMetadataValue = string | number | boolean | null;

export const adminAuditActionEnum = pgEnum(
  "admin_audit_action",
  adminAuditActionValues,
);

export type AdminAuditAction = (typeof adminAuditActionEnum.enumValues)[number];
export type UserAuditAction = Extract<
  AdminAuditAction,
  "memory.character_forget"
>;

export const adminAuditEvent = pgTable("admin_audit_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  actorLabel: text("actor_label").notNull(),
  action: adminAuditActionEnum("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata")
    .$type<Record<string, AdminAuditMetadataValue>>()
    .notNull(),
  operationId: text("operation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
