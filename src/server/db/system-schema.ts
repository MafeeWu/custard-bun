import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workerHeartbeat = pgTable("worker_heartbeat", {
  worker: text("worker").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
