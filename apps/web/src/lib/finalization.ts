import { v4 as uuid } from "uuid";
import { broadcastFinalizeHackathonOnChain, waitForFinalizeReceipt } from "./chain";
import { formatHackathon, loadHackathonLeaderboard, parseHackathonMeta, sanitizeString, serializeHackathonMeta } from "./hackathons";
import { enqueueJob } from "./queue";
import { supabaseAdmin } from "./supabase";
import { telegramHackathonFinalized } from "./telegram";

type Winner = { wallet: string; shareBps: number; agent_id: string };

function getConfiguredChainId(): number | null {
  const parsed = Number.parseInt(process.env.CHAIN_ID || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function createOrReuseFinalizationRun(options: {
  hackathonId: string;
  winnerTeamId: string;
  winnerAgentId: string;
  winners: Winner[];
  notes?: string | null;
  scores?: unknown;
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("finalization_runs")
    .select("*")
    .eq("hackathon_id", options.hackathonId)
    .in("status", ["queued", "broadcasting", "polling_receipt", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw new Error(`Failed to check finalization run: ${existingError.message}`);
  if (existing) return { run: existing, created: false };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let insertedRun: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("finalization_runs")
      .insert({
        hackathon_id: options.hackathonId,
        winner_team_id: options.winnerTeamId,
        winner_agent_id: options.winnerAgentId,
        winners: options.winners,
        notes: options.notes ?? null,
        scores: options.scores ?? null,
        status: "queued",
      })
      .select("*")
      .single();

    if (!error) { insertedRun = data; break; }
    if (error.code !== "23505") throw new Error(`Failed to create finalization run: ${error.message}`);

    // Concurrent insert won — fetch the row they created.
    const { data: race } = await supabaseAdmin
      .from("finalization_runs")
      .select("*")
      .eq("hackathon_id", options.hackathonId)
      .in("status", ["queued", "broadcasting", "polling_receipt", "completed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (race) return { run: race, created: false };
  }
  if (!insertedRun) throw new Error("Failed to create finalization run after retries");

  const job = await enqueueJob({
    type: "escrow.finalize",
    payload: { finalization_run_id: insertedRun.id },
    maxAttempts: 10,
  });

  await supabaseAdmin.from("finalization_runs").update({ job_id: job.id }).eq("id", insertedRun.id);
  return { run: { ...insertedRun, job_id: job.id }, created: true };
}

export async function runEscrowFinalization(finalizationRunId: string) {
  const { data: run, error } = await supabaseAdmin
    .from("finalization_runs")
    .select("*")
    .eq("id", finalizationRunId)
    .single();

  if (error || !run) throw new Error(error?.message || "Finalization run not found");
  if (run.status === "completed") return;

  const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", run.hackathon_id).single();
  if (!hackathon) throw new Error("Hackathon not found");

  const meta = parseHackathonMeta(hackathon.judging_criteria);
  if (hackathon.status === "completed" || meta.finalize_tx_hash) {
    await supabaseAdmin.from("finalization_runs").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id);
    return;
  }
  if (!meta.contract_address) throw new Error("Hackathon does not have a configured contract address");

  let txHash = run.tx_hash as string | null;
  const winners = run.winners as Winner[];
  const now = new Date().toISOString();

  // If a previous attempt failed after broadcasting, restore the active status so the
  // partial unique index prevents a concurrent run from being created for this hackathon.
  if (run.status === "failed" && txHash) {
    await supabaseAdmin.from("finalization_runs").update({ status: "polling_receipt", updated_at: now }).eq("id", run.id);
  }

  try {
    if (!txHash) {
      await supabaseAdmin.from("finalization_runs").update({ status: "broadcasting", attempts: (run.attempts || 0) + 1, started_at: run.started_at ?? now, updated_at: now }).eq("id", run.id);
      txHash = await broadcastFinalizeHackathonOnChain({
        contractAddress: meta.contract_address,
        winners: winners.map((w) => ({ wallet: w.wallet, shareBps: w.shareBps })),
      });
      await supabaseAdmin.from("finalization_runs").update({ status: "polling_receipt", tx_hash: txHash, updated_at: new Date().toISOString() }).eq("id", run.id);
      await enqueueJob({ type: "escrow.finalize", payload: { finalization_run_id: run.id }, runAt: new Date(Date.now() + 15_000), maxAttempts: 10 });
      return;
    }

    await waitForFinalizeReceipt(txHash);

    const finalizedAt = new Date().toISOString();
    const leaderAgentId = run.winner_agent_id as string;
    const notes = sanitizeString(run.notes, 4000);

    const { data: updatedHackathon, error: updateErr } = await supabaseAdmin
      .from("hackathons")
      .update({
        status: "completed",
        updated_at: finalizedAt,
        judging_criteria: serializeHackathonMeta({
          ...meta,
          chain_id: meta.chain_id ?? getConfiguredChainId(),
          winner_agent_id: leaderAgentId,
          winner_team_id: run.winner_team_id,
          winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps })),
          finalization_notes: notes,
          finalized_at: finalizedAt,
          finalize_tx_hash: txHash,
          scores: run.scores ?? meta.scores,
        }),
      })
      .eq("id", run.hackathon_id)
      .select("*")
      .single();

    if (updateErr) throw new Error("Failed to finalize hackathon");

    await supabaseAdmin.from("teams").update({ status: "judged" }).eq("id", run.winner_team_id);
    await supabaseAdmin.from("activity_log").insert({
      id: uuid(),
      hackathon_id: run.hackathon_id,
      team_id: run.winner_team_id,
      agent_id: leaderAgentId,
      event_type: "hackathon_finalized",
      event_data: {
        winner_team_id: run.winner_team_id,
        winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps })),
        finalize_tx_hash: txHash,
        contract_address: meta.contract_address,
        notes,
      },
    });

    await loadHackathonLeaderboard(run.hackathon_id);
    void formatHackathon(updatedHackathon as Record<string, unknown>);

    await supabaseAdmin.from("finalization_runs").update({ status: "completed", completed_at: finalizedAt, updated_at: finalizedAt }).eq("id", run.id);

    try {
      const { data: agentRow } = await supabaseAdmin.from("agents").select("display_name, name").eq("id", leaderAgentId).single();
      await telegramHackathonFinalized({
        id: run.hackathon_id,
        title: hackathon.title,
        winner_name: agentRow?.display_name || agentRow?.name || null,
      });
    } catch { /* best-effort */ }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from("finalization_runs").update({ status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("id", run.id);
    throw error;
  }
}
