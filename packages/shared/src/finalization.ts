import { sql } from "drizzle-orm";
import { broadcastFinalizeHackathonOnChain, waitForFinalizeReceipt } from "./chain";
import { formatHackathon, loadHackathonLeaderboard, parseHackathonMeta, sanitizeString, serializeHackathonMeta } from "./hackathons";
import { getDb } from "./db";
import { enqueueJob } from "./queue";
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
  const existingRows = await getDb().execute(sql<Record<string, unknown>>`
    select * from finalization_runs
    where hackathon_id = ${options.hackathonId}
      and status in ('queued', 'broadcasting', 'polling_receipt', 'completed')
    order by created_at desc
    limit 1
  `) as unknown as Array<Record<string, unknown>>;
  const existing = existingRows[0];
  if (existing) return { run: existing, created: false };

  let insertedRun: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await getDb().execute(sql<Record<string, unknown>>`
        insert into finalization_runs (hackathon_id, winner_team_id, winner_agent_id, winners, notes, scores, status)
        values (${options.hackathonId}, ${options.winnerTeamId}, ${options.winnerAgentId}, ${JSON.stringify(options.winners)}::jsonb, ${options.notes ?? null}, ${options.scores ? JSON.stringify(options.scores) : null}::jsonb, 'queued')
        returning *
      `) as unknown as Array<Record<string, unknown>>;
      insertedRun = rows[0] ?? null;
      if (insertedRun) break;
    } catch (error) {
      const cause = error as { code?: string; message?: string };
      if (cause.code !== "23505") throw new Error(`Failed to create finalization run: ${cause.message ?? String(error)}`);
    }

    // Concurrent insert won — fetch the row they created.
    const raceRows = await getDb().execute(sql<Record<string, unknown>>`
      select * from finalization_runs
      where hackathon_id = ${options.hackathonId}
        and status in ('queued', 'broadcasting', 'polling_receipt', 'completed')
      order by created_at desc
      limit 1
    `) as unknown as Array<Record<string, unknown>>;
    const race = raceRows[0];
    if (race) return { run: race, created: false };
  }
  if (!insertedRun) throw new Error("Failed to create finalization run after retries");

  const job = await enqueueJob({
    type: "escrow.finalize",
    payload: { finalization_run_id: insertedRun.id },
    maxAttempts: 10,
  });

  await getDb().execute(sql`update finalization_runs set job_id = ${job.id}, updated_at = now() where id = ${insertedRun.id}`);
  return { run: { ...insertedRun, job_id: job.id }, created: true };
}

export async function runEscrowFinalization(finalizationRunId: string) {
  const runRows = await getDb().execute(sql<Record<string, unknown>>`select * from finalization_runs where id = ${finalizationRunId} limit 1`) as unknown as Array<Record<string, unknown>>;
  const run = runRows[0];
  if (!run) throw new Error("Finalization run not found");
  if (run.status === "completed") return;

  const hackathonRows = await getDb().execute(sql<Record<string, unknown>>`select * from hackathons where id = ${run.hackathon_id} limit 1`) as unknown as Array<Record<string, unknown>>;
  const hackathon = hackathonRows[0];
  if (!hackathon) throw new Error("Hackathon not found");

  const meta = parseHackathonMeta(hackathon.judging_criteria);
  if (hackathon.status === "completed" || meta.finalize_tx_hash) {
    await getDb().execute(sql`update finalization_runs set status = 'completed', completed_at = now(), updated_at = now() where id = ${run.id}`);
    return;
  }
  if (!meta.contract_address) throw new Error("Hackathon does not have a configured contract address");

  let txHash = run.tx_hash as string | null;
  const winners = run.winners as Winner[];
  const now = new Date().toISOString();

  // If a previous attempt failed after broadcasting, restore the active status so the
  // partial unique index prevents a concurrent run from being created for this hackathon.
  if (run.status === "failed" && txHash) {
    await getDb().execute(sql`update finalization_runs set status = 'polling_receipt', updated_at = ${now} where id = ${run.id}`);
  }

  try {
    if (!txHash) {
      await getDb().execute(sql`
        update finalization_runs
        set status = 'broadcasting', attempts = attempts + 1, started_at = coalesce(started_at, ${now}), updated_at = ${now}
        where id = ${run.id}
      `);
      txHash = await broadcastFinalizeHackathonOnChain({
        contractAddress: meta.contract_address,
        winners: winners.map((w) => ({ wallet: w.wallet, shareBps: w.shareBps })),
      });
      await getDb().execute(sql`update finalization_runs set status = 'polling_receipt', tx_hash = ${txHash}, updated_at = now() where id = ${run.id}`);
      await enqueueJob({ type: "escrow.finalize", payload: { finalization_run_id: run.id }, runAt: new Date(Date.now() + 15_000), maxAttempts: 10 });
      return;
    }

    await waitForFinalizeReceipt(txHash);

    const finalizedAt = new Date().toISOString();
    const leaderAgentId = run.winner_agent_id as string;
    const hackathonId = run.hackathon_id as string;
    const winnerTeamId = run.winner_team_id as string;
    const notes = sanitizeString(run.notes, 4000);

    const updatedHackathonRows = await getDb().execute(sql<Record<string, unknown>>`
      update hackathons
      set status = 'completed',
          updated_at = ${finalizedAt},
          judging_criteria = ${JSON.stringify(serializeHackathonMeta({
          ...meta,
          chain_id: meta.chain_id ?? getConfiguredChainId(),
          winner_agent_id: leaderAgentId,
          winner_team_id: winnerTeamId,
          winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps })),
          finalization_notes: notes,
          finalized_at: finalizedAt,
          finalize_tx_hash: txHash,
          scores: run.scores ?? meta.scores,
        }))}::jsonb
      where id = ${hackathonId}
      returning *
    `) as unknown as Array<Record<string, unknown>>;
    const updatedHackathon = updatedHackathonRows[0];
    if (!updatedHackathon) throw new Error("Failed to finalize hackathon");

    await getDb().execute(sql`update teams set status = 'judged' where id = ${winnerTeamId}`);
    await getDb().execute(sql`
      insert into activity_log (hackathon_id, team_id, agent_id, event_type, event_data)
      values (${hackathonId}, ${winnerTeamId}, ${leaderAgentId}, 'hackathon_finalized', ${JSON.stringify({
        winner_team_id: winnerTeamId,
        winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps })),
        finalize_tx_hash: txHash,
        contract_address: meta.contract_address,
        notes,
      })}::jsonb)
    `);

    await loadHackathonLeaderboard(hackathonId);
    void formatHackathon(updatedHackathon as Record<string, unknown>);

    await getDb().execute(sql`update finalization_runs set status = 'completed', completed_at = ${finalizedAt}, updated_at = ${finalizedAt} where id = ${run.id}`);

    try {
      const agentRows = await getDb().execute(sql<{ display_name: string | null; name: string }>`select display_name, name from agents where id = ${leaderAgentId} limit 1`) as unknown as Array<{ display_name: string | null; name: string }>;
      const agentRow = agentRows[0];
      await telegramHackathonFinalized({
        id: hackathonId,
        title: String(hackathon.title),
        winner_name: agentRow?.display_name || agentRow?.name || null,
      });
    } catch { /* best-effort */ }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await getDb().execute(sql`update finalization_runs set status = 'failed', last_error = ${message}, updated_at = now() where id = ${run.id}`);
    throw error;
  }
}
