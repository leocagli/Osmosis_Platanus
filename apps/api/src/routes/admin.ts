import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../../../web/src/lib/supabase";
import { parseHackathonMeta, sanitizeString } from "../../../web/src/lib/hackathons";
import { normalizeAddress } from "../../../web/src/lib/chain";
import { createOrReuseJudgingRun } from "../../../web/src/lib/judging-runs";
import { createOrReuseFinalizationRun } from "../../../web/src/lib/finalization";
import { validateWinnerShares, isValidUUID, WINNER_MIN_BPS } from "../../../web/src/lib/validation";
import { extractToken, authenticateAdminToken } from "../../../web/src/lib/auth";
import { ok, fail, notFound } from "../respond";

async function resolveAuth(req: { headers: { authorization?: string } }): Promise<{ isAdmin: boolean; agentId: string | null }> {
  const token = extractToken(req.headers.authorization ?? null);
  if (!token) return { isAdmin: false, agentId: null };
  if (authenticateAdminToken(token)) return { isAdmin: true, agentId: null };

  if (!token.startsWith("buildersclaw_") && !token.startsWith("hackaclaw_")) {
    return { isAdmin: false, agentId: null };
  }
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: agent } = await supabaseAdmin.from("agents").select("id").eq("api_key_hash", hash).single();
  return { isAdmin: false, agentId: agent?.id ?? null };
}

export async function adminRoutes(fastify: FastifyInstance) {
  // POST /api/v1/admin/hackathons/:id/judge
  fastify.post("/api/v1/admin/hackathons/:id/judge", async (req, reply) => {
    const { id: hackathonId } = req.params as { id: string };

    if (!isValidUUID(hackathonId)) return fail(reply, "Invalid hackathon ID format", 400);

    const { isAdmin, agentId } = await resolveAuth(req);

    if (!isAdmin) {
      if (!agentId) return fail(reply, "Admin or hackathon creator authentication required", 401);

      const { data: hackathonAuth } = await supabaseAdmin
        .from("hackathons").select("created_by").eq("id", hackathonId).single();
      if (!hackathonAuth) return notFound(reply, "Hackathon");
      if (hackathonAuth.created_by !== agentId) {
        return fail(reply, "Only the hackathon creator or admin can trigger judging", 403);
      }
    }

    const { data: hackathon } = await supabaseAdmin
      .from("hackathons").select("*").eq("id", hackathonId).single();
    if (!hackathon) return notFound(reply, "Hackathon");

    const { data: allSubs } = await supabaseAdmin
      .from("submissions")
      .select("id, status, preview_url, build_log")
      .eq("hackathon_id", hackathonId);

    if (!allSubs || allSubs.length === 0) {
      return fail(reply, "No submissions to judge. Wait for builders to submit their repos.", 400);
    }

    const viableCount = allSubs.filter((sub) => {
      if (sub.status !== "completed") return false;
      let repoUrl: string | null = null;
      try { const meta = JSON.parse(sub.build_log || "{}"); repoUrl = meta.repo_url || meta.project_url || null; } catch { /* */ }
      if (!repoUrl) repoUrl = sub.preview_url;
      return !!repoUrl;
    }).length;

    const count = allSubs.length;
    if (viableCount === 0) {
      return fail(reply, `Found ${count} submission(s) but none have valid repository URLs.`, 400, {
        total_submissions: count,
        viable_submissions: 0,
        hint: "Submissions need a valid repo_url pointing to a GitHub repository.",
      });
    }

    try {
      const { run, created } = await createOrReuseJudgingRun(hackathonId);
      return ok(reply, {
        message: created ? "Judging accepted and queued." : "Judging is already queued or running.",
        judging_run_id: run.id,
        status: run.status,
        job_id: run.job_id,
        total_submissions: count,
        viable_submissions: viableCount,
      }, 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Judging failed";
      return fail(reply, `Judging failed: ${message}`, 500);
    }
  });

  // POST /api/v1/admin/hackathons/:id/finalize
  fastify.post("/api/v1/admin/hackathons/:id/finalize", async (req, reply) => {
    const token = extractToken((req.headers as { authorization?: string }).authorization ?? null);
    if (!token || !authenticateAdminToken(token)) {
      return fail(reply, "Admin authentication required", 401, "Add 'Authorization: Bearer <ADMIN_API_KEY>' header.");
    }

    const { id: hackathonId } = req.params as { id: string };
    if (!isValidUUID(hackathonId)) return fail(reply, "Invalid hackathon ID format", 400);

    const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();
    if (!hackathon) return notFound(reply, "Hackathon");

    if (hackathon.status === "completed") {
      const existingMeta = parseHackathonMeta(hackathon.judging_criteria);
      return fail(reply, "Hackathon is already finalized", 409, {
        finalized_at: existingMeta.finalized_at,
        finalize_tx_hash: existingMeta.finalize_tx_hash,
        winner_team_id: existingMeta.winner_team_id,
      });
    }

    const body = req.body as Record<string, unknown>;
    let winnerTeamId = sanitizeString(body.winner_team_id as string, 64);
    const winnerAgentId = sanitizeString(body.winner_agent_id as string, 64);

    if (!winnerTeamId && !winnerAgentId) {
      return fail(reply, "winner_team_id or winner_agent_id is required", 400);
    }

    const meta = parseHackathonMeta(hackathon.judging_criteria);
    if (!meta.contract_address) {
      return fail(reply, "Hackathon does not have a configured contract address", 400);
    }

    if (!winnerTeamId && winnerAgentId) {
      const { data: membership } = await supabaseAdmin
        .from("team_members")
        .select("team_id, teams!inner(hackathon_id)")
        .eq("agent_id", winnerAgentId)
        .eq("teams.hackathon_id", hackathonId)
        .single();
      if (!membership) return fail(reply, "winner_agent_id is not registered in this hackathon", 400);
      winnerTeamId = (membership as { team_id: string }).team_id;
    }

    const { data: members } = await supabaseAdmin
      .from("team_members")
      .select("agent_id, revenue_share_pct, role, agents!inner(wallet_address)")
      .eq("team_id", winnerTeamId!)
      .eq("status", "active");

    if (!members || members.length === 0) {
      return fail(reply, "Winning team has no active members", 400);
    }

    const missingWallets = members.filter((m) => {
      const agent = m.agents as unknown as { wallet_address?: string | null } | null;
      return !agent?.wallet_address;
    });
    if (missingWallets.length > 0) {
      const ids = missingWallets.map((m) => m.agent_id).join(", ");
      return fail(reply, `Team members missing wallet addresses: ${ids}. All members must have wallets for on-chain prize splitting.`, 400);
    }

    const rawBps = members.map((m) => Math.round(m.revenue_share_pct * 100));
    const totalRaw = rawBps.reduce((sum, v) => sum + v, 0);
    if (totalRaw !== 10000) rawBps[rawBps.length - 1] += 10000 - totalRaw;

    const winners = members.map((m, i) => {
      const agent = m.agents as unknown as { wallet_address: string };
      let wallet: string;
      try { wallet = normalizeAddress(agent.wallet_address); }
      catch { throw new Error(`Invalid wallet address for agent ${m.agent_id}`); }
      return { wallet, shareBps: rawBps[i], agent_id: m.agent_id };
    });

    const shareValidation = validateWinnerShares(winners);
    if (!shareValidation.valid) {
      return fail(reply, `Winner share validation failed: ${shareValidation.issues.join("; ")}`, 400, {
        issues: shareValidation.issues,
        winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps, share_pct: (w.shareBps / 100).toFixed(1) + "%" })),
        min_bps: WINNER_MIN_BPS,
      });
    }

    const walletSet = new Set(winners.map((w) => w.wallet.toLowerCase()));
    if (walletSet.size !== winners.length) {
      return fail(reply, "Duplicate wallet addresses detected. Each team member must have a unique wallet.", 400);
    }

    const notes = sanitizeString(body.notes as string, 4000);
    const leaderAgentId = members.find((m) => m.role === "leader")?.agent_id ?? members[0].agent_id;

    try {
      const { run, created } = await createOrReuseFinalizationRun({
        hackathonId,
        winnerTeamId: winnerTeamId!,
        winnerAgentId: leaderAgentId,
        winners,
        notes,
        scores: body.scores ?? meta.scores,
      });

      return ok(reply, {
        message: created ? "Escrow finalization accepted and queued." : "Escrow finalization is already queued or running.",
        finalization_run_id: run.id,
        status: run.status,
        job_id: run.job_id,
        tx_hash: run.tx_hash,
        winner_team_id: winnerTeamId,
        winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps })),
        notes,
      }, 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to queue escrow finalization";
      return fail(reply, message, 500);
    }
  });
}
