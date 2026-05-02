import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { getContractPrizePool, getUsdcDecimals, getUsdcSymbol, verifySponsorFunding } from "@buildersclaw/shared/chain";
import { hashToken } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { serializeHackathonMeta } from "@buildersclaw/shared/hackathons";
import { telegramHackathonCreated } from "@buildersclaw/shared/telegram";
import { checkRateLimit } from "@buildersclaw/shared/validation";
import { ok, created, fail, notFound, unauthorized } from "../respond";
import { adminAuthFastify } from "../auth";

const proposalSelect = {
  id: schema.enterpriseProposals.id,
  company: schema.enterpriseProposals.company,
  contact_email: schema.enterpriseProposals.contactEmail,
  track: schema.enterpriseProposals.track,
  problem_description: schema.enterpriseProposals.problemDescription,
  budget: schema.enterpriseProposals.budget,
  timeline: schema.enterpriseProposals.timeline,
  status: schema.enterpriseProposals.status,
  admin_notes: schema.enterpriseProposals.adminNotes,
  judge_agent: schema.enterpriseProposals.judgeAgent,
  approval_token: schema.enterpriseProposals.approvalToken,
  hackathon_config: schema.enterpriseProposals.hackathonConfig,
  prize_amount: schema.enterpriseProposals.prizeAmount,
  judging_priorities: schema.enterpriseProposals.judgingPriorities,
  tech_requirements: schema.enterpriseProposals.techRequirements,
  created_at: schema.enterpriseProposals.createdAt,
  reviewed_at: schema.enterpriseProposals.reviewedAt,
};

function sanitize(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

function generateJudgeKey() {
  return `judge_${crypto.randomBytes(32).toString("hex")}`;
}

function formatProposal<T extends { prize_amount: string | null }>(proposal: T) {
  return {
    ...proposal,
    prize_amount: proposal.prize_amount === null ? null : Number(proposal.prize_amount),
  };
}

function formatUnits(value: bigint, decimals: number) {
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals) || "0";
  const fraction = decimals > 0 ? raw.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

function parseDeadline(raw: string) {
  const withOffset = raw.includes("T") && !raw.endsWith("Z") && !/[+-]\d\d:?\d\d$/.test(raw) ? `${raw}-03:00` : raw;
  return new Date(withOffset);
}

type ProposalConfig = {
  title?: string;
  brief?: string;
  rules?: string;
  deadline?: string;
  min_participants?: number;
  team_size_max?: number;
  challenge_type?: string;
  judge_key_hash?: string;
  contract_address?: string;
  chain_id?: number | null;
  funding_verified?: boolean;
  sponsor_wallet?: string;
  funding_amount_units?: string;
  token_address?: string;
  token_symbol?: string;
  token_decimals?: number;
};

export async function proposalRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/proposals", async (req, reply) => {
    const clientIp = ((req.headers as Record<string, string>)["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const rateCheck = checkRateLimit(`proposals:${clientIp}`, 3, 3600_000);
    if (!rateCheck.allowed) return fail(reply, "Too many proposal submissions. Try again later.", 429);

    const body = req.body as Record<string, unknown> || {};
    const company = sanitize(body.company, 200);
    const email = sanitize(body.email, 320);
    const track = sanitize(body.track, 100);
    const problem = sanitize(body.problem, 5000);
    const judgeAgent = sanitize(body.judge_agent, 50);
    const budget = sanitize(body.budget, 100);
    const timeline = sanitize(body.timeline, 100);
    const prizeAmount = sanitize(body.prize_amount, 20);
    const judgingPriorities = sanitize(body.judging_priorities, 2000);
    const techRequirements = sanitize(body.tech_requirements, 2000);

    const hackathonConfig: Record<string, unknown> = {
      title: sanitize(body.hackathon_title, 200),
      brief: sanitize(body.hackathon_brief, 5000),
      rules: sanitize(body.hackathon_rules, 2000),
      deadline: sanitize(body.hackathon_deadline, 30),
      min_participants: Math.max(2, Math.min(500, Number(body.hackathon_min_participants) || 5)),
      team_size_max: Math.max(1, Math.min(20, Number(body.hackathon_team_size_max) || 5)),
      challenge_type: sanitize(body.challenge_type, 50) || "other",
      contract_address: sanitize(body.contract_address, 128),
      chain_id: Number.isInteger(Number(body.chain_id)) ? Number(body.chain_id) : null,
    };

    if (!company || !email || !problem || !track) return fail(reply, "company, email, track, and problem are required", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(reply, "Invalid email address", 400);
    if (!hackathonConfig.title || !hackathonConfig.brief || !hackathonConfig.deadline) {
      return fail(reply, "hackathon_title, hackathon_brief, and hackathon_deadline are required", 400);
    }

    const fundingTxHash = sanitize(body.funding_tx_hash, 128);
    const sponsorWallet = sanitize(body.sponsor_wallet, 128);
    if (fundingTxHash && hackathonConfig.contract_address) {
      if (!sponsorWallet) return fail(reply, "sponsor_wallet is required when funding_tx_hash is provided", 400);
      try {
        const funding = await verifySponsorFunding({ contractAddress: String(hackathonConfig.contract_address), sponsorWallet, txHash: fundingTxHash });
        hackathonConfig.funding_tx_hash = fundingTxHash;
        hackathonConfig.sponsor_wallet = sponsorWallet;
        hackathonConfig.funding_verified = true;
        hackathonConfig.funding_amount_units = funding.prizePoolUnits.toString();
        hackathonConfig.token_address = funding.tokenAddress;
        hackathonConfig.token_symbol = getUsdcSymbol();
        hackathonConfig.token_decimals = getUsdcDecimals();
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return fail(reply, `Funding verification failed: ${message}`, 400);
      }
    }

    const isCustomJudge = judgeAgent === "own";
    const judgeKey = isCustomJudge ? generateJudgeKey() : null;
    if (judgeKey) hackathonConfig.judge_key_hash = hashToken(judgeKey);

    const id = crypto.randomUUID();
    try {
      await getDb().insert(schema.enterpriseProposals).values({
        id,
        company,
        contactEmail: email,
        track,
        problemDescription: problem,
        judgeAgent,
        budget,
        timeline,
        prizeAmount: prizeAmount ? Number(prizeAmount).toString() : null,
        judgingPriorities,
        techRequirements,
        hackathonConfig,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    } catch {
      return fail(reply, "Failed to submit proposal. Try again.", 500);
    }

    return created(reply, {
      id,
      message: hackathonConfig.funding_verified ? "Sponsored challenge submitted and funding verified on-chain. Pending admin approval." : "Challenge submitted. We'll review it and get back to you.",
      ...(hackathonConfig.funding_verified ? { funding_verified: true, funding_amount_units: hackathonConfig.funding_amount_units } : {}),
      ...(judgeKey ? {
        judge_api_key: judgeKey,
        judge_skill_url: "https://www.buildersclaw.xyz/judge-skill.md",
        judge_instructions: "Save this judge API key NOW. It will not be shown again. It activates when your hackathon is approved.",
      } : {}),
    });
  });

  fastify.get("/api/v1/proposals", async (req, reply) => {
    if (!adminAuthFastify(req)) return unauthorized(reply, "Admin authentication required");
    const { status } = req.query as { status?: string };
    try {
      const db = getDb();
      const rows = status
        ? await db.select(proposalSelect).from(schema.enterpriseProposals).where(eq(schema.enterpriseProposals.status, status)).orderBy(desc(schema.enterpriseProposals.createdAt)).limit(100)
        : await db.select(proposalSelect).from(schema.enterpriseProposals).orderBy(desc(schema.enterpriseProposals.createdAt)).limit(100);
      return ok(reply, rows.map(formatProposal));
    } catch {
      return fail(reply, "Query failed", 500);
    }
  });

  fastify.patch("/api/v1/proposals", async (req, reply) => {
    if (!adminAuthFastify(req)) return unauthorized(reply, "Admin authentication required");
    const body = req.body as Record<string, unknown> || {};
    const id = sanitize(body.id, 64);
    const newStatus = sanitize(body.status, 20);
    if (!id || !newStatus || !["approved", "rejected"].includes(newStatus)) {
      return fail(reply, "id and status (approved|rejected) required", 400);
    }

    const db = getDb();
    const [proposal] = await db.select(proposalSelect).from(schema.enterpriseProposals).where(eq(schema.enterpriseProposals.id, id)).limit(1);
    if (!proposal) return notFound(reply, "Proposal");
    if (proposal.status !== "pending") return fail(reply, `Proposal already ${proposal.status}`, 409);

    let hackathonId: string | null = null;
    let hackathonUrl: string | null = null;

    if (newStatus === "approved" && proposal.hackathon_config) {
      const cfg = proposal.hackathon_config as ProposalConfig;
      if (cfg.title && cfg.brief && cfg.deadline) {
        const endsAt = parseDeadline(cfg.deadline);
        if (Number.isNaN(endsAt.getTime())) return fail(reply, `Invalid deadline date: "${cfg.deadline}". Cannot create hackathon.`, 400);

        let prizePool = Number(proposal.prize_amount) || 0;
        let sponsorAddress: string | null = null;
        if (cfg.funding_verified && cfg.contract_address) {
          try {
            const balanceUnits = await getContractPrizePool(cfg.contract_address);
            if (balanceUnits <= BigInt(0)) return fail(reply, "Escrow contract has no funds. Sponsor may have called abort().", 400);
            prizePool = Number(formatUnits(balanceUnits, cfg.token_decimals || getUsdcDecimals()));
            sponsorAddress = cfg.sponsor_wallet || null;
          } catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            return fail(reply, `Failed to verify contract funds: ${message}`, 400);
          }
        }

        hackathonId = crypto.randomUUID();
        const baseMeta = JSON.parse(serializeHackathonMeta({
          chain_id: typeof cfg.chain_id === "number" ? cfg.chain_id : null,
          contract_address: cfg.contract_address || null,
          sponsor_address: sponsorAddress,
          token_address: cfg.token_address || process.env.USDC_ADDRESS || null,
          token_symbol: cfg.token_symbol || process.env.USDC_SYMBOL || "USDC",
          token_decimals: typeof cfg.token_decimals === "number" ? cfg.token_decimals : getUsdcDecimals(),
          criteria_text: cfg.rules || null,
        })) as Record<string, unknown>;
        if (proposal.judge_agent === "own" && cfg.judge_key_hash) {
          baseMeta.judge_type = "custom";
          baseMeta.judge_key_hash = cfg.judge_key_hash;
        }

        try {
          await db.insert(schema.hackathons).values({
            id: hackathonId,
            title: cfg.title,
            description: `Enterprise hackathon by ${proposal.company}`,
            brief: cfg.brief,
            rules: cfg.rules || null,
            entryType: cfg.contract_address ? "on_chain" : "off_chain",
            entryFee: 0,
            prizePool,
            platformFeePct: 0.1,
            maxParticipants: 500,
            teamSizeMin: 1,
            teamSizeMax: cfg.team_size_max || 5,
            buildTimeSeconds: 180,
            challengeType: cfg.challenge_type || "other",
            status: "open",
            createdBy: null,
            startsAt: new Date().toISOString(),
            endsAt: endsAt.toISOString(),
            judgingCriteria: baseMeta,
          });
          hackathonUrl = `/hackathons/${hackathonId}`;
          telegramHackathonCreated({ id: hackathonId, title: cfg.title, prize_pool: prizePool, challenge_type: cfg.challenge_type || "other" }).catch(() => {});
        } catch {
          hackathonId = null;
        }
      }
    }

    try {
      await db.update(schema.enterpriseProposals).set({
        status: hackathonId ? "hackathon_created" : newStatus,
        adminNotes: sanitize(body.notes, 2000) || (hackathonId ? `Hackathon auto-created: ${hackathonId}` : null),
        reviewedAt: new Date().toISOString(),
      }).where(eq(schema.enterpriseProposals.id, id));
    } catch {
      return fail(reply, "Update failed", 500);
    }

    return ok(reply, {
      id,
      status: hackathonId ? "hackathon_created" : newStatus,
      ...(hackathonId ? { hackathon_id: hackathonId, hackathon_url: hackathonUrl } : {}),
      ...(hackathonId && typeof (proposal.hackathon_config as ProposalConfig | null)?.contract_address === "string" ? { contract_address: (proposal.hackathon_config as ProposalConfig).contract_address } : {}),
    });
  });
}
