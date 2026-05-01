import { supabaseAdmin } from "./supabase";
import { continueGenLayerJudging, judgeHackathon } from "./judge";
import { telegramHackathonFinalized } from "./telegram";
import { enqueueJob } from "./queue";
import { createOrReuseJudgingRun } from "./judging-runs";

/**
 * Judge expired hackathons (open or in_progress) whose ends_at has passed.
 * Called daily by Vercel cron + on-demand via check-deadline + list page visits.
 */
export async function processExpiredHackathons(options: { enqueueOnly?: boolean } = {}) {
  const now = new Date().toISOString();
  const processed: Array<{ id: string; title: string; action: string; success?: boolean; skipped?: boolean; reason?: string; error?: string }> = [];

  const { data: expiredHackathons, error: fetchErr } = await supabaseAdmin
    .from("hackathons")
    .select("id, title, ends_at, judging_criteria, status")
    .lt("ends_at", now)
    .in("status", ["open", "in_progress"]);

  if (fetchErr) {
    console.error("Error fetching expired hackathons:", fetchErr);
    return { count: 0, processed: [] };
  }

  if (!expiredHackathons || expiredHackathons.length === 0) {
    console.log("No expired hackathons to judge.");
    await pruneOldFinalizedHackathons();
    return { count: 0, processed: [] };
  }

  for (const hackathon of expiredHackathons) {
    let isCustomJudge = false;
    try {
      const meta = typeof hackathon.judging_criteria === "string"
        ? JSON.parse(hackathon.judging_criteria)
        : hackathon.judging_criteria;
      isCustomJudge = meta?.judge_type === "custom";
    } catch { /* ignore */ }

    if (isCustomJudge) {
      console.log(`Skipping custom-judge hackathon: ${hackathon.title} (${hackathon.id})`);
      processed.push({ id: hackathon.id, title: hackathon.title, action: "judge", skipped: true, reason: "custom_judge" });
      continue;
    }

    try {
      if (options.enqueueOnly) {
        const { run } = await createOrReuseJudgingRun(hackathon.id);
        processed.push({ id: hackathon.id, title: hackathon.title, action: "queued_judging", success: true, reason: run.id });
        continue;
      }

      console.log(`Auto-judging: ${hackathon.title} (${hackathon.id})`);
      await judgeHackathon(hackathon.id);
      processed.push({ id: hackathon.id, title: hackathon.title, action: "judged", success: true });

      // Notify Telegram community (fire-and-forget)
      try {
        const { data: h } = await supabaseAdmin
          .from("hackathons").select("judging_criteria").eq("id", hackathon.id).single();
        let winnerName: string | null = null;
        if (h?.judging_criteria) {
          const meta = typeof h.judging_criteria === "string" ? JSON.parse(h.judging_criteria) : h.judging_criteria;
          if (meta.winner_agent_id) {
            const { data: agent } = await supabaseAdmin
              .from("agents").select("display_name, name").eq("id", meta.winner_agent_id).single();
            winnerName = agent?.display_name || agent?.name || null;
          }
        }
        const { count: subCount } = await supabaseAdmin
          .from("submissions").select("*", { count: "exact", head: true }).eq("hackathon_id", hackathon.id);
        telegramHackathonFinalized({
          id: hackathon.id,
          title: hackathon.title,
          winner_name: winnerName,
          total_submissions: subCount || 0,
        }).catch(() => {});
      } catch { /* telegram is best-effort */ }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to judge hackathon ${hackathon.id}:`, errMsg);
      processed.push({ id: hackathon.id, title: hackathon.title, action: "judge", success: false, error: errMsg });
    }
  }

  // Cleanup: keep only the last 8 finalized hackathons
  await pruneOldFinalizedHackathons();

  return { count: processed.length, processed };
}

export async function processQueuedGenLayerHackathons(options: { enqueueOnly?: boolean } = {}) {
  const processed: Array<{ id: string; title: string; action: string; success?: boolean; skipped?: boolean; reason?: string; error?: string }> = [];

  const { data: judgingHackathons, error: fetchErr } = await supabaseAdmin
    .from("hackathons")
    .select("id, title, judging_criteria, status")
    .eq("status", "judging")
    .order("created_at", { ascending: true })
    .limit(10);

  if (fetchErr) {
    console.error("Error fetching queued GenLayer hackathons:", fetchErr);
    return { count: 0, processed: [] };
  }

  for (const hackathon of judgingHackathons || []) {
    let meta: Record<string, unknown> = {};
    try {
      meta = typeof hackathon.judging_criteria === "string"
        ? JSON.parse(hackathon.judging_criteria)
        : (hackathon.judging_criteria || {});
    } catch {
      meta = {};
    }

    if (!meta.genlayer_status) {
      processed.push({ id: hackathon.id, title: hackathon.title, action: "genlayer", skipped: true, reason: "not_queued" });
      continue;
    }

    try {
      if (options.enqueueOnly) {
        await enqueueJob({
          type: "continue_genlayer_judging",
          payload: { hackathon_id: hackathon.id },
          runAt: new Date(),
          maxAttempts: 20,
        });
        processed.push({ id: hackathon.id, title: hackathon.title, action: "queued_genlayer", success: true });
        continue;
      }

      const advanced = await continueGenLayerJudging(hackathon.id);
      processed.push({ id: hackathon.id, title: hackathon.title, action: "genlayer", success: advanced });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to advance GenLayer hackathon ${hackathon.id}:`, errMsg);
      processed.push({ id: hackathon.id, title: hackathon.title, action: "genlayer", success: false, error: errMsg });
    }
  }

  return { count: processed.length, processed };
}

/**
 * Keep only the 8 most recent finalized hackathons. Delete the rest
 * along with their teams, submissions, prompt_rounds, team_members, and activity_log.
 */
export async function pruneOldFinalizedHackathons() {
  const { data: finalized } = await supabaseAdmin
    .from("hackathons")
    .select("id")
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (!finalized || finalized.length <= 8) return;

  const toDelete = finalized.slice(8).map((h) => h.id);
  console.log(`Pruning ${toDelete.length} old finalized hackathons`);

  for (const hId of toDelete) {
    await supabaseAdmin.from("activity_log").delete().eq("hackathon_id", hId);
    await supabaseAdmin.from("prompt_rounds").delete().eq("hackathon_id", hId);
    await supabaseAdmin.from("marketplace_listings").delete().eq("hackathon_id", hId);

    const { data: subs } = await supabaseAdmin.from("submissions").select("id").eq("hackathon_id", hId);
    if (subs) {
      for (const s of subs) {
        await supabaseAdmin.from("evaluations").delete().eq("submission_id", s.id);
      }
    }
    await supabaseAdmin.from("submissions").delete().eq("hackathon_id", hId);

    const { data: teams } = await supabaseAdmin.from("teams").select("id").eq("hackathon_id", hId);
    if (teams) {
      for (const t of teams) {
        await supabaseAdmin.from("team_members").delete().eq("team_id", t.id);
      }
    }
    await supabaseAdmin.from("teams").delete().eq("hackathon_id", hId);
    await supabaseAdmin.from("hackathons").delete().eq("id", hId);
  }

  console.log(`Pruned ${toDelete.length} old hackathons`);
}
