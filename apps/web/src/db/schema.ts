import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type JobStatus = "pending" | "running" | "completed" | "failed";
export type JobPayload = Record<string, unknown>;

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  status: text("status").$type<JobStatus>().notNull().default("pending"),
  payload: jsonb("payload").$type<JobPayload>().notNull().default({}),
  runAt: timestamp("run_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lockedBy: text("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
  lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true, mode: "string" }),
  lastError: text("last_error"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  failedAt: timestamp("failed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
