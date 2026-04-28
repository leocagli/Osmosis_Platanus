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
        team_size_max: 1,
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
