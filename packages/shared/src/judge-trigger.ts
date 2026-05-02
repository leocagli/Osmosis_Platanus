import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { continueGenLayerJudging, judgeHackathon } from "./judge";
import { telegramHackathonFinalized } from "./telegram";
import { enqueueJob } from "./queue";
import { createOrReuseJudgingRun } from "./judging-runs";
import { getDb } from "./db";
import { activityLog, agents, evaluations, hackathons, marketplaceListings, promptRounds, submissions, teamMembers, teams } from "./db/schema";

/**
 * Judge expired hackathons (open or in_progress) whose ends_at has passed.
 * Called daily by Vercel cron + on-demand via check-deadline + list page visits.
 */
export async function processExpiredHackathons(options: { enqueueOnly?: boolean } = {}) {
  const now = new Date().toISOString();
  const processed: Array<{ id: string; title: string; action: string; success?: boolean; skipped?: boolean; reason?: string; error?: string }> = [];

  let expiredHackathons: Array<{ id: string; title: string; judgingCriteria: unknown }> = [];
  try {
    expiredHackathons = await getDb()
      .select({ id: hackathons.id, title: hackathons.title, judgingCriteria: hackathons.judgingCriteria })
      .from(hackathons)
      .where(and(lt(hackathons.endsAt, now), inArray(hackathons.status, ["open", "in_progress"])));
  } catch (fetchErr) {
    console.error("Error fetching expired hackathons:", fetchErr);
    return { count: 0, processed: [] };
  }

  if (expiredHackathons.length === 0) {
    console.log("No expired hackathons to judge.");
    await pruneOldFinalizedHackathons();
    return { count: 0, processed: [] };
  }

  for (const hackathon of expiredHackathons) {
    let isCustomJudge = false;
    try {
      const meta = typeof hackathon.judgingCriteria === "string"
        ? JSON.parse(hackathon.judgingCriteria)
        : hackathon.judgingCriteria;
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
        const [h] = await getDb()
          .select({ judgingCriteria: hackathons.judgingCriteria })
          .from(hackathons)
          .where(eq(hackathons.id, hackathon.id))
          .limit(1);
        let winnerName: string | null = null;
        if (h?.judgingCriteria) {
          const meta = typeof h.judgingCriteria === "string" ? JSON.parse(h.judgingCriteria) : h.judgingCriteria;
          if (meta.winner_agent_id) {
            const [agent] = await getDb()
              .select({ displayName: agents.displayName, name: agents.name })
              .from(agents)
              .where(eq(agents.id, meta.winner_agent_id))
              .limit(1);
            winnerName = agent?.displayName || agent?.name || null;
          }
        }
        const [submissionCount] = await getDb()
          .select({ value: count() })
          .from(submissions)
          .where(eq(submissions.hackathonId, hackathon.id));
        telegramHackathonFinalized({
          id: hackathon.id,
          title: hackathon.title,
          winner_name: winnerName,
          total_submissions: submissionCount?.value || 0,
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

  let judgingHackathons: Array<{ id: string; title: string; judgingCriteria: unknown }> = [];
  try {
    judgingHackathons = await getDb()
      .select({ id: hackathons.id, title: hackathons.title, judgingCriteria: hackathons.judgingCriteria })
      .from(hackathons)
      .where(eq(hackathons.status, "judging"))
      .orderBy(hackathons.createdAt)
      .limit(10);
  } catch (fetchErr) {
    console.error("Error fetching queued GenLayer hackathons:", fetchErr);
    return { count: 0, processed: [] };
  }

  for (const hackathon of judgingHackathons) {
    let meta: Record<string, unknown> = {};
    try {
      meta = typeof hackathon.judgingCriteria === "string"
        ? JSON.parse(hackathon.judgingCriteria)
        : (hackathon.judgingCriteria || {});
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
  const finalized = await getDb()
    .select({ id: hackathons.id })
    .from(hackathons)
    .where(eq(hackathons.status, "completed"))
    .orderBy(desc(hackathons.createdAt));

  if (finalized.length <= 8) return;

  const toDelete = finalized.slice(8).map((h) => h.id);
  console.log(`Pruning ${toDelete.length} old finalized hackathons`);

  for (const hId of toDelete) {
    await getDb().transaction(async (tx) => {
      await tx.delete(activityLog).where(eq(activityLog.hackathonId, hId));
      await tx.delete(promptRounds).where(eq(promptRounds.hackathonId, hId));
      await tx.delete(marketplaceListings).where(eq(marketplaceListings.hackathonId, hId));

      const subs = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.hackathonId, hId));
      for (const s of subs) {
        await tx.delete(evaluations).where(eq(evaluations.submissionId, s.id));
      }
      await tx.delete(submissions).where(eq(submissions.hackathonId, hId));

      const teamRows = await tx.select({ id: teams.id }).from(teams).where(eq(teams.hackathonId, hId));
      for (const t of teamRows) {
        await tx.delete(teamMembers).where(eq(teamMembers.teamId, t.id));
      }
      await tx.delete(teams).where(eq(teams.hackathonId, hId));
      await tx.delete(hackathons).where(eq(hackathons.id, hId));
    });
  }

  console.log(`Pruned ${toDelete.length} old hackathons`);
}
