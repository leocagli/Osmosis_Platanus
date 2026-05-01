import { supabaseAdmin } from "./supabase";

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

export async function enqueueJob<TPayload extends Record<string, unknown>>(options: {
  type: JobType;
  payload?: TPayload;
  runAt?: Date | string;
  maxAttempts?: number;
}) {
  const payload = options.payload ?? ({} as TPayload);
  assertBoundedPayload(payload);

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .insert({
      type: options.type,
      payload,
      run_at: typeof options.runAt === "string" ? options.runAt : (options.runAt ?? new Date()).toISOString(),
      max_attempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to enqueue job: ${error.message}`);
  return data as JobRecord<TPayload>;
}

export async function claimDueJob(workerId: string) {
  const { data, error } = await supabaseAdmin.rpc("claim_due_job", {
    p_worker_id: workerId,
    p_default_stale_seconds: 60 * 5,
    p_limit: 1,
  });

  if (error) throw new Error(`Failed to claim job: ${error.message}`);
  const job = Array.isArray(data) ? data[0] : null;
  if (!job) return null;

  const staleSeconds = getStaleLockSeconds(job.type);
  await supabaseAdmin
    .from("jobs")
    .update({ lock_expires_at: new Date(Date.now() + staleSeconds * 1000).toISOString() })
    .eq("id", job.id)
    .eq("locked_by", workerId);

  return { ...job, lock_expires_at: new Date(Date.now() + staleSeconds * 1000).toISOString() } as JobRecord;
}

export async function completeJob(jobId: string, workerId: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "completed",
      completed_at: now,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("status", "running")
    .eq("locked_by", workerId);

  if (error) throw new Error(`Failed to complete job: ${error.message}`);
}

export async function failOrRetryJob(job: JobRecord, cause: unknown, delaySeconds?: number) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const now = new Date().toISOString();

  if (job.attempts >= job.max_attempts) {
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({
        status: "failed",
        last_error: message,
        failed_at: now,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        updated_at: now,
      })
      .eq("id", job.id);
    if (error) throw new Error(`Failed to mark job failed: ${error.message}`);
    return "failed" as const;
  }

  const retryDelay = delaySeconds ?? Math.min(60 * 30, 2 ** Math.max(0, job.attempts - 1) * 30);
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "pending",
      run_at: new Date(Date.now() + retryDelay * 1000).toISOString(),
      last_error: message,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: now,
    })
    .eq("id", job.id);

  if (error) throw new Error(`Failed to retry job: ${error.message}`);
  return "retrying" as const;
}

export async function pruneTerminalJobs() {
  const completedBefore = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const failedBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin
    .from("jobs")
    .delete()
    .or(`and(status.eq.completed,completed_at.lt.${completedBefore}),and(status.eq.failed,failed_at.lt.${failedBefore})`);

  if (error) throw new Error(`Failed to prune jobs: ${error.message}`);
}
