import { and, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { jobs, type JobRow } from "./db/schema";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export type JobType =
  | "process_expired_hackathons"
  | "continue_genlayer_judging"
  | "judge_hackathon"
  | "telegram.process_update"
  | "agent_webhook.deliver"
  | "escrow.finalize"
  | "jobs.prune";

export interface JobRecord<TPayload = Record<string, unknown>> {
  id: string;
  type: JobType | string;
  status: JobStatus;
  payload: TPayload;
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  last_error: string | null;
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_PAYLOAD_BYTES = 32_000;

export const JOB_STALE_LOCK_SECONDS: Record<string, number> = {
  judge_hackathon: 60 * 45,
  continue_genlayer_judging: 60 * 5,
  "telegram.process_update": 60 * 2,
  "agent_webhook.deliver": 60 * 2,
  "escrow.finalize": 60 * 5,
  "jobs.prune": 60 * 5,
};

function assertBoundedPayload(payload: Record<string, unknown>) {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`Job payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
}

export function getStaleLockSeconds(type: string) {
  return JOB_STALE_LOCK_SECONDS[type] ?? 60 * 5;
}

function serializeTimestamp(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toJobRecord<TPayload = Record<string, unknown>>(job: JobRow): JobRecord<TPayload> {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload as TPayload,
    run_at: serializeTimestamp(job.runAt)!,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    locked_by: job.lockedBy,
    locked_at: serializeTimestamp(job.lockedAt),
    lock_expires_at: serializeTimestamp(job.lockExpiresAt),
    last_error: job.lastError,
    completed_at: serializeTimestamp(job.completedAt),
    failed_at: serializeTimestamp(job.failedAt),
    created_at: serializeTimestamp(job.createdAt)!,
    updated_at: serializeTimestamp(job.updatedAt)!,
  };
}

function normalizeJobRecord<TPayload = Record<string, unknown>>(job: JobRecord<TPayload>): JobRecord<TPayload> {
  return {
    ...job,
    run_at: serializeTimestamp(job.run_at)!,
    locked_at: serializeTimestamp(job.locked_at),
    lock_expires_at: serializeTimestamp(job.lock_expires_at),
    completed_at: serializeTimestamp(job.completed_at),
    failed_at: serializeTimestamp(job.failed_at),
    created_at: serializeTimestamp(job.created_at)!,
    updated_at: serializeTimestamp(job.updated_at)!,
  };
}

export async function enqueueJob<TPayload extends Record<string, unknown>>(options: {
  type: JobType | string;
  payload?: TPayload;
  runAt?: Date | string;
  maxAttempts?: number;
}) {
  const payload = options.payload ?? ({} as TPayload);
  assertBoundedPayload(payload);

  try {
    const [job] = await getDb()
      .insert(jobs)
      .values({
        type: options.type,
        payload,
        runAt: typeof options.runAt === "string" ? options.runAt : (options.runAt ?? new Date()).toISOString(),
        maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      })
      .returning();

    return toJobRecord<TPayload>(job);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to enqueue job: ${message}`);
  }
}

export async function claimDueJob(workerId: string) {
  let rows: JobRecord[];
  try {
    rows = (await getDb().execute(
      sql<JobRecord>`select * from claim_due_job(${workerId}, ${60 * 5}, ${1})`,
    )) as unknown as JobRecord[];
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to claim job: ${message}`);
  }

  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job) return null;

  const staleSeconds = getStaleLockSeconds(job.type);
  const lockExpiresAt = new Date(Date.now() + staleSeconds * 1000).toISOString();
  await getDb()
    .update(jobs)
    .set({ lockExpiresAt })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)));

  return normalizeJobRecord({ ...job, lock_expires_at: lockExpiresAt });
}

export async function completeJob(jobId: string, workerId: string) {
  const now = new Date().toISOString();
  try {
    await getDb()
      .update(jobs)
      .set({
        status: "completed",
        completedAt: now,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to complete job: ${message}`);
  }
}

export async function failOrRetryJob(job: JobRecord, cause: unknown, delaySeconds?: number) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const now = new Date().toISOString();

  if (job.attempts >= job.max_attempts) {
    try {
      await getDb()
        .update(jobs)
        .set({
          status: "failed",
          lastError: message,
          failedAt: now,
          lockedBy: null,
          lockedAt: null,
          lockExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id));
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Failed to mark job failed: ${errorMessage}`);
    }
    return "failed" as const;
  }

  const retryDelay = delaySeconds ?? Math.min(60 * 30, 2 ** Math.max(0, job.attempts - 1) * 30);
  try {
    await getDb()
      .update(jobs)
      .set({
        status: "pending",
        runAt: new Date(Date.now() + retryDelay * 1000).toISOString(),
        lastError: message,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));
  } catch (cause) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to retry job: ${errorMessage}`);
  }
  return "retrying" as const;
}

export async function pruneTerminalJobs() {
  const completedBefore = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const failedBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await getDb()
      .delete(jobs)
      .where(
        or(
          and(eq(jobs.status, "completed"), lt(jobs.completedAt, completedBefore)),
          and(eq(jobs.status, "failed"), lt(jobs.failedAt, failedBefore)),
        ),
      );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to prune jobs: ${message}`);
  }
}
