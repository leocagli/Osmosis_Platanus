import { and, desc, eq, inArray } from "drizzle-orm";
import { enqueueJob } from "./queue";
import { getDb } from "./db";
import { judgingRuns, type JudgingRunRow } from "./db/schema";

function toJudgingRun(row: JudgingRunRow) {
  return {
    id: row.id,
    hackathon_id: row.hackathonId,
    job_id: row.jobId,
    status: row.status,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    last_error: row.lastError,
    metadata: row.metadata,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

const ACTIVE_STATUSES = ["queued", "running", "waiting_genlayer"] as const;

export async function createOrReuseJudgingRun(hackathonId: string) {
  const [existing] = await getDb()
    .select()
    .from(judgingRuns)
    .where(and(eq(judgingRuns.hackathonId, hackathonId), inArray(judgingRuns.status, ACTIVE_STATUSES)))
    .orderBy(desc(judgingRuns.createdAt))
    .limit(1);

  if (existing) return { run: toJudgingRun(existing), created: false };

  let insertedRun: JudgingRunRow | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [data] = await getDb()
      .insert(judgingRuns)
      .values({ hackathonId, status: "queued" })
      .onConflictDoNothing()
      .returning();

    if (data) { insertedRun = data; break; }

    // Concurrent insert won — fetch the row they created.
    const [race] = await getDb()
      .select()
      .from(judgingRuns)
      .where(and(eq(judgingRuns.hackathonId, hackathonId), inArray(judgingRuns.status, ACTIVE_STATUSES)))
      .orderBy(desc(judgingRuns.createdAt))
      .limit(1);
    if (race) return { run: toJudgingRun(race), created: false };
  }
  if (!insertedRun) throw new Error("Failed to create judging run after retries");

  const job = await enqueueJob({
    type: "judging.freeze_submissions",
    payload: { hackathon_id: hackathonId, judging_run_id: insertedRun.id },
    maxAttempts: 3,
  });

  const [updatedRun] = await getDb()
    .update(judgingRuns)
    .set({ jobId: job.id })
    .where(eq(judgingRuns.id, insertedRun.id))
    .returning();
  return { run: toJudgingRun(updatedRun), created: true };
}

export async function updateJudgingRun(
  runId: string | undefined,
  status: "running" | "waiting_genlayer" | "completed" | "failed",
  details?: { error?: string; metadata?: Record<string, unknown> },
) {
  if (!runId) return;

  const now = new Date().toISOString();
  const update: Partial<typeof judgingRuns.$inferInsert> = {
    status,
    updatedAt: now,
    lastError: details?.error ?? null,
  };
  if (status === "running") update.startedAt = now;
  if (status === "completed" || status === "failed") update.completedAt = now;
  if (details?.metadata) update.metadata = details.metadata;

  await getDb().update(judgingRuns).set(update).where(eq(judgingRuns.id, runId));
}

export async function updateActiveJudgingRunForHackathon(
  hackathonId: string,
  status: "running" | "waiting_genlayer" | "completed" | "failed",
  details?: { error?: string; metadata?: Record<string, unknown> },
) {
  const [data] = await getDb()
    .select({ id: judgingRuns.id })
    .from(judgingRuns)
    .where(and(eq(judgingRuns.hackathonId, hackathonId), inArray(judgingRuns.status, ACTIVE_STATUSES)))
    .orderBy(desc(judgingRuns.createdAt))
    .limit(1);

  await updateJudgingRun(data?.id, status, details);
}
