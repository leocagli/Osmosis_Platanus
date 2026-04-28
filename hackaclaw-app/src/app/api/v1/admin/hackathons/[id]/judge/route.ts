import { NextRequest } from "next/server";
import { authenticateAdminRequest } from "@/lib/auth";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { judgeHackathon } from "@/lib/judge";
import { loadHackathonLeaderboard, formatHackathon } from "@/lib/hackathons";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/hackathons/:id/judge — Trigger AI judging for a hackathon.
 * 
 * This fetches all submitted repos, analyzes the code, scores each submission,
 * and picks the winner. The hackathon moves to "completed" status.
 * 
 * Requires admin auth OR the hackathon creator's agent key.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  // Allow admin OR check if it's the creator
  const isAdmin = authenticateAdminRequest(req);
  
  if (!isAdmin) {
    // Check if the auth header matches the creator's agent key
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer hackaclaw_")) {
      return error("Admin or hackathon creator authentication required", 401);
    }
    
    const apiKeyRaw = auth.replace("Bearer ", "");
    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256").update(apiKeyRaw).digest("hex");
    
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("api_key_hash", hash)
      .single();

    if (!agent) {
      return error("Invalid authentication", 401);
    }

    const { id: hackathonId } = await params;
    const { data: hackathon } = await supabaseAdmin
      .from("hackathons")
      .select("created_by")
      .eq("id", hackathonId)
      .single();

    if (!hackathon) return notFound("Hackathon");
    if (hackathon.created_by !== agent.id) {
      return error("Only the hackathon creator or admin can trigger judging", 403);
    }
  }

  const { id: hackathonId } = await params;
  
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return notFound("Hackathon");

  // Check if there are any submissions
  const { count } = await supabaseAdmin
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("hackathon_id", hackathonId);

  if (!count || count === 0) {
    return error("No submissions to judge. Wait for builders to submit their repos.", 400);
  }

  try {
    console.log(`[JUDGE] Starting AI judging for hackathon ${hackathonId}...`);
    await judgeHackathon(hackathonId);
    console.log(`[JUDGE] Judging complete for hackathon ${hackathonId}`);

    const leaderboard = await loadHackathonLeaderboard(hackathonId);
    const updated = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();

    return success({
      message: "Judging complete! The AI analyzed all submitted repositories.",
      hackathon: formatHackathon((updated.data || hackathon) as Record<string, unknown>),
      leaderboard,
      submissions_judged: count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Judging failed";
    console.error(`[JUDGE] Error judging hackathon ${hackathonId}:`, err);
    return error(`Judging failed: ${message}`, 500);
  }
}
