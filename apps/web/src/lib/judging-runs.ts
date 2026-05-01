import { enqueueJob } from "./queue";
import { supabaseAdmin } from "./supabase";

export async function createOrReuseJudgingRun(hackathonId: string) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("judging_runs")
    .select("*")
    .eq("hackathon_id", hackathonId)
    .in("status", ["queued", "running", "waiting_genlayer"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw new Error(`Failed to check judging run: ${existingError.message}`);
  if (existing) return { run: existing, created: false };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let insertedRun: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("judging_runs")
      .insert({ hackathon_id: hackathonId, status: "queued" })
      .select("*")
      .single();

    if (!error) { insertedRun = data; break; }
    if (error.code !== "23505") throw new Error(`Failed to create judging run: ${error.message}`);

    // Concurrent insert won — fetch the row they created.
    const { data: race } = await supabaseAdmin
      .from("judging_runs")
      .select("*")
      .eq("hackathon_id", hackathonId)
      .in("status", ["queued", "running", "waiting_genlayer"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (race) return { run: race, created: false };
  }
  if (!insertedRun) throw new Error("Failed to create judging run after retries");

  const job = await enqueueJob({
    type: "judge_hackathon",
    payload: { hackathon_id: hackathonId, judging_run_id: insertedRun.id },
    maxAttempts: 3,
  });

  await supabaseAdmin.from("judging_runs").update({ job_id: job.id }).eq("id", insertedRun.id);
  return { run: { ...insertedRun, job_id: job.id }, created: true };
}

export async function updateJudgingRun(
  runId: string | undefined,
  status: "running" | "waiting_genlayer" | "completed" | "failed",
  details?: { error?: string; metadata?: Record<string, unknown> },
) {
  if (!runId) return;

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status,
    updated_at: now,
    last_error: details?.error ?? null,
  };
  if (status === "running") update.started_at = now;
  if (status === "completed" || status === "failed") update.completed_at = now;
  if (details?.metadata) update.metadata = details.metadata;

  await supabaseAdmin.from("judging_runs").update(update).eq("id", runId);
}

export async function updateActiveJudgingRunForHackathon(
  hackathonId: string,
  status: "running" | "waiting_genlayer" | "completed" | "failed",
  details?: { error?: string; metadata?: Record<string, unknown> },
) {
  const { data } = await supabaseAdmin
    .from("judging_runs")
    .select("id")
    .eq("hackathon_id", hackathonId)
    .in("status", ["queued", "running", "waiting_genlayer"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await updateJudgingRun(data?.id, status, details);
}
