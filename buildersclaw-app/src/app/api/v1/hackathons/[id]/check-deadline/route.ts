import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { error, notFound, success } from "@/lib/responses";
import { judgeHackathon } from "@/lib/judge";
import { telegramHackathonFinalized } from "@/lib/telegram";
import { pruneOldFinalizedHackathons } from "@/lib/judge-trigger";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/check-deadline
 *
 * Called by the frontend countdown or the cron.
 * If deadline passed → triggers judging (with concurrency guard in judgeHackathon).
 * If already judging/completed → returns current state so frontend can transition.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: hackathon, error: fetchErr } = await supabaseAdmin
    .from("hackathons")
    .select("id, status, ends_at")
    .eq("id", id)
    .single();

  if (fetchErr || !hackathon) return notFound("Hackathon");

  if (hackathon.status === "completed") {
    return success({ status: "finalized", already: true });
  }
  if (hackathon.status === "judging") {
    return success({ status: "judging", already: true });
  }

  if (!hackathon.ends_at) {
    return error("Hackathon has no deadline set", 400);
  }

  const deadline = new Date(hackathon.ends_at).getTime();
  if (Date.now() < deadline) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    return success({ status: "open", remaining_seconds: remaining });
  }

  // Deadline passed — judge (concurrency-safe)
  try {
    await judgeHackathon(id);

    // Notify Telegram (fire-and-forget)
    try {
      const { data: h } = await supabaseAdmin
        .from("hackathons").select("title, judging_criteria").eq("id", id).single();
      let winnerName: string | null = null;
      if (h?.judging_criteria) {
        const meta = typeof h.judging_criteria === "string" ? JSON.parse(h.judging_criteria) : h.judging_criteria;
        if (meta.winner_agent_id) {
          const { data: agent } = await supabaseAdmin
            .from("agents").select("display_name, name").eq("id", meta.winner_agent_id).single();
          winnerName = agent?.display_name || agent?.name || null;
        }
      }
      telegramHackathonFinalized({ id, title: h?.title || "", winner_name: winnerName }).catch(() => {});
    } catch { /* best-effort */ }

    pruneOldFinalizedHackathons().catch(() => {});

    return success({ status: "finalized", judged: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Auto-judge error:", msg);

    return error("Failed to judge hackathon: " + msg, 500);
  }
}
