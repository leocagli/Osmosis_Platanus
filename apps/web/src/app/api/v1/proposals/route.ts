import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { formatUnits } from "viem";
import { authenticateAdminRequest, hashToken } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { serializeHackathonMeta } from "@buildersclaw/shared/hackathons";
import { getContractPrizePool, getUsdcDecimals, getUsdcSymbol, verifySponsorFunding } from "@buildersclaw/shared/chain";
import { telegramHackathonCreated } from "@buildersclaw/shared/telegram";
import { v4 as uuid } from "uuid";
import { checkRateLimit } from "@buildersclaw/shared/validation";

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

function formatProposal<T extends { prize_amount: string | null }>(proposal: T) {
  return {
    ...proposal,
    prize_amount: proposal.prize_amount === null ? null : Number(proposal.prize_amount),
  };
}

function sanitize(val: unknown, max: number): string | null {
  if (typeof val !== "string") return null;
  return val.trim().slice(0, max) || null;
}

/** Generate a judge-specific API key */
function generateJudgeKey(): string {
  return `judge_${crypto.randomBytes(32).toString("hex")}`;
}

/**
 * POST /api/v1/proposals — Submit an enterprise proposal (public, no auth).
 *
 * If judge_agent="own", generates a judge_xxx key immediately and returns it.
 * The enterprise saves this key — it will work once the hackathon is approved and created.
 * The key hash is stored in the proposal so it can be copied to the hackathon on approval.
 */
export async function POST(req: NextRequest) {
  try {
    // ── SECURITY: Rate limit proposals — prevent spam ──
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateCheck = checkRateLimit(`proposals:${clientIp}`, 3, 3600_000); // 3 per hour per IP
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: { message: "Too many proposal submissions. Try again later." } },
        { status: 429 },
      );
    }

    const body = await req.json();

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

    // Sponsor funding: if contract_address and funding_tx_hash provided, verify on-chain
    const fundingTxHash = sanitize(body.funding_tx_hash, 128);
    const sponsorWallet = sanitize(body.sponsor_wallet, 128);

    if (fundingTxHash && hackathonConfig.contract_address) {
      if (!sponsorWallet) {
        return NextResponse.json(
          { success: false, error: { message: "sponsor_wallet is required when funding_tx_hash is provided" } },
          { status: 400 },
        );
      }

      try {
        const funding = await verifySponsorFunding({
          contractAddress: hackathonConfig.contract_address as string,
          sponsorWallet,
          txHash: fundingTxHash,
        });

        hackathonConfig.funding_tx_hash = fundingTxHash;
        hackathonConfig.sponsor_wallet = sponsorWallet;
        hackathonConfig.funding_verified = true;
        hackathonConfig.funding_amount_units = funding.prizePoolUnits.toString();
        hackathonConfig.token_address = funding.tokenAddress;
        hackathonConfig.token_symbol = getUsdcSymbol();
        hackathonConfig.token_decimals = getUsdcDecimals();
      } catch (verifyErr) {
        return NextResponse.json(
          { success: false, error: { message: `Funding verification failed: ${verifyErr instanceof Error ? verifyErr.message : "unknown error"}` } },
          { status: 400 },
        );
      }
    }

    if (!hackathonConfig.title || !hackathonConfig.brief || !hackathonConfig.deadline) {
      return NextResponse.json(
        { success: false, error: { message: "hackathon_title, hackathon_brief, and hackathon_deadline are required" } },
        { status: 400 },
      );
    }

    if (!company || !email || !problem || !track) {
      return NextResponse.json(
        { success: false, error: { message: "company, email, track, and problem are required" } },
        { status: 400 },
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: { message: "Invalid email address" } },
        { status: 400 },
      );
    }

    // Generate judge key upfront if custom judge selected
    const isCustomJudge = judgeAgent === "own";
    let judgeKey: string | null = null;
    let judgeKeyHash: string | null = null;

    if (isCustomJudge) {
      judgeKey = generateJudgeKey();
      judgeKeyHash = hashToken(judgeKey);
    }

    const id = uuid();
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
        hackathonConfig: {
          ...hackathonConfig,
          ...(judgeKeyHash ? { judge_key_hash: judgeKeyHash } : {}),
        },
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    } catch (insertErr) {
      console.error("Proposal insert failed:", insertErr);
      return NextResponse.json(
        { success: false, error: { message: "Failed to submit proposal. Try again." } },
        { status: 500 },
      );
    }

    // Build response
    const responseData: Record<string, unknown> = {
      id,
      message: hackathonConfig.funding_verified
        ? "Sponsored challenge submitted and funding verified on-chain. Pending admin approval."
        : "Challenge submitted. We'll review it and get back to you.",
    };

    if (hackathonConfig.funding_verified) {
      responseData.funding_verified = true;
      responseData.funding_amount_units = hackathonConfig.funding_amount_units;
    }

    // If custom judge, return the key — this is the ONLY time it's shown
    if (judgeKey) {
      responseData.judge_api_key = judgeKey;
      responseData.judge_skill_url = "https://www.buildersclaw.xyz/judge-skill.md";
      responseData.judge_instructions = "Save this judge API key NOW — it will NOT be shown again. It activates when your hackathon is approved. Tell your judge agent to read the judge-skill.md for instructions.";
    }

    return NextResponse.json({ success: true, data: responseData }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { message: "Invalid request" } },
      { status: 400 },
    );
  }
}

/**
 * GET /api/v1/proposals — List all proposals (admin only).
 */
export async function GET(req: NextRequest) {
  if (!authenticateAdminRequest(req)) {
    return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const db = getDb();

  try {
    const data = status
      ? await db
          .select(proposalSelect)
          .from(schema.enterpriseProposals)
          .where(eq(schema.enterpriseProposals.status, status))
          .orderBy(desc(schema.enterpriseProposals.createdAt))
          .limit(100)
      : await db
          .select(proposalSelect)
          .from(schema.enterpriseProposals)
          .orderBy(desc(schema.enterpriseProposals.createdAt))
          .limit(100);

    return NextResponse.json({ success: true, data: data.map(formatProposal) });
  } catch {
    return NextResponse.json({ success: false, error: { message: "Query failed" } }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/proposals — Update proposal status (admin only).
 * Body: { id, status: "approved" | "rejected", notes? }
 *
 * On "approved": auto-creates the hackathon from hackathon_config.
 * The judge_key_hash from the proposal is copied to the hackathon's judging_criteria.
 */
export async function PATCH(req: NextRequest) {
  if (!authenticateAdminRequest(req)) {
    return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = sanitize(body.id, 64);
    const newStatus = sanitize(body.status, 20);

    if (!id || !newStatus || !["approved", "rejected"].includes(newStatus)) {
      return NextResponse.json(
        { success: false, error: { message: "id and status (approved|rejected) required" } },
        { status: 400 },
      );
    }

    const db = getDb();
    const [proposal] = await db
      .select(proposalSelect)
      .from(schema.enterpriseProposals)
      .where(eq(schema.enterpriseProposals.id, id))
      .limit(1);

    if (!proposal) {
      return NextResponse.json({ success: false, error: { message: "Proposal not found" } }, { status: 404 });
    }

    if (proposal.status !== "pending") {
      return NextResponse.json({ success: false, error: { message: `Proposal already ${proposal.status}` } }, { status: 409 });
    }

    let hackathonId: string | null = null;
    let hackathonUrl: string | null = null;

    // Auto-create hackathon on approve
    if (newStatus === "approved" && proposal.hackathon_config) {
      const cfg = proposal.hackathon_config as {
        title?: string; brief?: string; rules?: string;
        deadline?: string; min_participants?: number; team_size_max?: number; challenge_type?: string;
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

      if (cfg.title && cfg.brief && cfg.deadline) {
        // The deadline from the form is in GMT-3 (Argentina time).
        // Append -03:00 offset so Date parses it correctly as GMT-3.
        const deadlineStr = cfg.deadline.includes("T")
          ? cfg.deadline + (cfg.deadline.includes("+") || cfg.deadline.includes("-", 10) || cfg.deadline.endsWith("Z") ? "" : "-03:00")
          : cfg.deadline;
        const endsAt = new Date(deadlineStr);
        if (isNaN(endsAt.getTime())) {
          return NextResponse.json(
            { success: false, error: { message: `Invalid deadline date: "${cfg.deadline}". Cannot create hackathon.` } },
            { status: 400 },
          );
        }

        // Allow past deadlines on approve — admin may want to adjust later
        hackathonId = uuid();

        // If sponsor-funded, re-verify contract still has funds
        let prizePool = Number(proposal.prize_amount) || 0;
        let sponsorAddress: string | null = null;

        if (cfg.funding_verified && cfg.contract_address) {
          try {
            const balanceUnits = await getContractPrizePool(cfg.contract_address);
            if (balanceUnits <= BigInt(0)) {
              return NextResponse.json(
                { success: false, error: { message: "Escrow contract has no funds. Sponsor may have called abort()." } },
                { status: 400 },
              );
            }
            prizePool = Number(formatUnits(balanceUnits, cfg.token_decimals || getUsdcDecimals()));
            sponsorAddress = cfg.sponsor_wallet || null;
          } catch (chainErr) {
            return NextResponse.json(
              { success: false, error: { message: `Failed to verify contract funds: ${chainErr instanceof Error ? chainErr.message : "unknown error"}` } },
              { status: 400 },
            );
          }
        }

        const judgingCriteria = serializeHackathonMeta({
          chain_id: typeof cfg.chain_id === "number" ? cfg.chain_id : null,
          contract_address: cfg.contract_address || null,
          sponsor_address: sponsorAddress,
          token_address: cfg.token_address || process.env.USDC_ADDRESS || null,
          token_symbol: cfg.token_symbol || process.env.USDC_SYMBOL || "USDC",
          token_decimals: typeof cfg.token_decimals === "number" ? cfg.token_decimals : getUsdcDecimals(),
          criteria_text: cfg.rules || null,
        });

        const insertPayload = {
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
          judgingCriteria,
        };

        try {
          await db.insert(schema.hackathons).values(insertPayload);
        } catch (insertErr) {
          console.error("Auto hackathon creation failed:", JSON.stringify(insertErr));
          hackathonId = null;
        }

        if (hackathonId) {
          hackathonUrl = `/hackathons/${hackathonId}`;

          // Notify Telegram community (fire-and-forget)
          telegramHackathonCreated({
            id: hackathonId,
            title: cfg.title,
            prize_pool: Number(proposal.prize_amount) || 0,
            challenge_type: cfg.challenge_type || "other",
          }).catch(() => {});
        }
      }
    }

    try {
      await db
        .update(schema.enterpriseProposals)
        .set({
          status: hackathonId ? "hackathon_created" : newStatus,
          adminNotes: sanitize(body.notes, 2000) || (hackathonId ? `Hackathon auto-created: ${hackathonId}` : null),
          reviewedAt: new Date().toISOString(),
        })
        .where(eq(schema.enterpriseProposals.id, id));
    } catch {
      return NextResponse.json({ success: false, error: { message: "Update failed" } }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id,
        status: hackathonId ? "hackathon_created" : newStatus,
        ...(hackathonId ? { hackathon_id: hackathonId, hackathon_url: hackathonUrl } : {}),
        ...(hackathonId && proposal.hackathon_config && typeof (proposal.hackathon_config as { contract_address?: string }).contract_address === "string"
          ? { contract_address: (proposal.hackathon_config as { contract_address?: string }).contract_address }
          : {}),
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: { message: "Invalid request" } }, { status: 400 });
  }
}
