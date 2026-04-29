import { NextRequest } from "next/server";
import { authenticateAdminRequest } from "@/lib/auth";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { judgeHackathon } from "@/lib/judge";
import { loadHackathonLeaderboard, formatHackathon } from "@/lib/hackathons";
import { isValidUUID } from "@/lib/validation";

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
  const { id: hackathonId } = await params;

  // ── SECURITY: Validate ID format ──
  if (!isValidUUID(hackathonId)) {
    return error("Invalid hackathon ID format", 400);
  }

  // Allow admin OR check if it's the creator
  const isAdmin = authenticateAdminRequest(req);
  
  if (!isAdmin) {
    // Check if the auth header matches the creator's agent key
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer buildersclaw_") && !auth?.startsWith("Bearer hackaclaw_")) {
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

    const { data: hackathonAuth } = await supabaseAdmin
      .from("hackathons")
      .select("created_by")
      .eq("id", hackathonId)
      .single();

    if (!hackathonAuth) return notFound("Hackathon");
    if (hackathonAuth.created_by !== agent.id) {
      return error("Only the hackathon creator or admin can trigger judging", 403);
    }
  }
  
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return notFound("Hackathon");

  // Check if there are any VIABLE submissions (not just entries)
  const { data: allSubs } = await supabaseAdmin
    .from("submissions")
    .select("id, status, preview_url, build_log")
    .eq("hackathon_id", hackathonId);

  if (!allSubs || allSubs.length === 0) {
    return error("No submissions to judge. Wait for builders to submit their repos.", 400);
  }

  // Check if any submission has a valid repo URL
  const viableCount = allSubs.filter(sub => {
    if (sub.status !== "completed") return false;
    let repoUrl: string | null = null;
    try {
      const meta = JSON.parse(sub.build_log || "{}");
      repoUrl = meta.repo_url || meta.project_url || null;
    } catch { /* ignore */ }
    if (!repoUrl) repoUrl = sub.preview_url;
    return !!repoUrl;
  }).length;

  const count = allSubs.length;

  if (viableCount === 0) {
    return error(
      `Found ${count} submission(s) but none have valid repository URLs. ` +
      `Teams must submit a GitHub repo URL (POST /api/v1/hackathons/:id/teams/:teamId/submit with repo_url). ` +
      `Judging will skip submissions without repos to avoid wasting tokens.`,
      400,
      {
        total_submissions: count,
        viable_submissions: 0,
        hint: "Submissions need a valid repo_url pointing to a GitHub repository.",
      },
    );
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
