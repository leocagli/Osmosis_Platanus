import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { success, error } from "@/lib/responses";
import { v4 as uuid } from "uuid";

/**
 * POST /api/v1/seed-test — Create a test hackathon (temporary, remove after testing).
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-seed-secret");
  if (secret !== "hackaclaw-test-2026") {
    return error("Unauthorized", 401);
  }

  try {
    const body = await req.json();

    // Add marketplace listing directly (bypasses schema cache issue)
    if (body.action === "add_listing") {
      const { error: err } = await supabaseAdmin
        .from("marketplace_listings")
        .insert({
          id: uuid(),
          agent_id: body.agent_id,
          hackathon_id: body.hackathon_id || null,
          skills: body.skills || "general",
          asking_share_pct: body.asking_share_pct || 20,
          description: body.description || null,
          status: "active",
          created_at: new Date().toISOString(),
        });
      if (err) return error("Listing insert: " + JSON.stringify(err), 500);
      return success({ ok: true });
    }

    // Update agent stats for leaderboard seeding
    if (body.action === "update_agent_stats") {
      const { error: err } = await supabaseAdmin
        .from("agents")
        .update({
          total_wins: body.total_wins ?? 0,
          total_hackathons: body.total_hackathons ?? 0,
          reputation_score: body.reputation_score ?? 50,
        })
        .eq("id", body.agent_id);
      if (err) return error("Agent stats update: " + JSON.stringify(err), 500);
      return success({ ok: true });
    }

    if (body.action === "add_member") {
      const { error: err } = await supabaseAdmin.from("team_members").insert({
        id: uuid(),
        team_id: body.team_id,
        agent_id: body.agent_id,
        role: body.role || "member",
        revenue_share_pct: body.share_pct || 25,
        status: "active",
      });
      if (err) return error("Member insert: " + JSON.stringify(err), 500);
      if (body.leader_id && body.share_pct) {
        const { data: ldr } = await supabaseAdmin
          .from("team_members").select("id, revenue_share_pct")
          .eq("team_id", body.team_id).eq("agent_id", body.leader_id).single();
        if (ldr) {
          await supabaseAdmin.from("team_members")
            .update({ revenue_share_pct: ldr.revenue_share_pct - body.share_pct })
            .eq("id", ldr.id);
        }
      }
      return success({ ok: true });
    }

    const id = uuid();
    const now = new Date();

    const { error: insertErr } = await supabaseAdmin
      .from("hackathons")
      .insert({
        id,
        title: body.title || "Platform Test Sprint",
        description: body.description || "Test hackathon",
        brief: body.brief || "Build the best AI-powered landing page",
        rules: body.rules || null,
        entry_type: "free",
        entry_fee: 0,
        prize_pool: body.prize_pool || 100,
        platform_fee_pct: 0.1,
        max_participants: 500,
        team_size_min: 1,
        team_size_max: body.team_size_max || 4,
        build_time_seconds: 180,
        challenge_type: body.challenge_type || "landing_page",
        status: "open",
        created_by: null,
        starts_at: now.toISOString(),
        ends_at: body.ends_at || new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      });

    if (insertErr) {
      return error("Insert failed: " + insertErr.message, 500);
    }

    return success({ id, url: `/hackathons/${id}` });
  } catch {
    return error("Invalid request", 400);
  }
}
