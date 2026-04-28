import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateAdminRequest } from "@/lib/auth";
import { v4 as uuid } from "uuid";

function sanitize(val: unknown, max: number): string | null {
  if (typeof val !== "string") return null;
  return val.trim().slice(0, max) || null;
}

/**
 * POST /api/v1/proposals — Submit an enterprise proposal (public, no auth).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const company = sanitize(body.company, 200);
    const email = sanitize(body.email, 320);
    const track = sanitize(body.track, 100);
    const problem = sanitize(body.problem, 5000);
    const judgeAgent = sanitize(body.judge_agent, 50);
    const budget = sanitize(body.budget, 100);
    const timeline = sanitize(body.timeline, 100);

    const hackathonConfig = {
      title: sanitize(body.hackathon_title, 200),
      brief: sanitize(body.hackathon_brief, 5000),
      rules: sanitize(body.hackathon_rules, 2000),
      deadline: sanitize(body.hackathon_deadline, 30),
      min_participants: Math.max(2, Math.min(500, Number(body.hackathon_min_participants) || 5)),
      challenge_type: sanitize(body.challenge_type, 50) || "landing_page",
    };

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

    const id = uuid();
    const { error: insertErr } = await supabaseAdmin
      .from("enterprise_proposals")
      .insert({
        id,
        company,
        contact_email: email,
        track,
        problem_description: problem,
        judge_agent: judgeAgent,
        budget,
        timeline,
        hackathon_config: hackathonConfig,
        status: "pending",
        created_at: new Date().toISOString(),
      });

    if (insertErr) {
      console.error("Proposal insert failed:", insertErr);
      return NextResponse.json(
        { success: false, error: { message: "Failed to submit proposal. Try again." } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { success: true, data: { id, message: "Proposal submitted. We'll review it and get back to you." } },
      { status: 201 },
    );
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
  let query = supabaseAdmin.from("enterprise_proposals").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error: queryErr } = await query.limit(100);
  if (queryErr) {
    return NextResponse.json({ success: false, error: { message: "Query failed" } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

/**
 * PATCH /api/v1/proposals — Update proposal status (admin only).
 * Body: { id, status: "approved" | "rejected", notes? }
 *
 * On "approved": auto-creates the hackathon from hackathon_config.
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

    // Fetch the proposal to get hackathon_config
    const { data: proposal } = await supabaseAdmin
      .from("enterprise_proposals")
      .select("*")
      .eq("id", id)
      .single();

    if (!proposal) {
      return NextResponse.json({ success: false, error: { message: "Proposal not found" } }, { status: 404 });
    }

    let hackathonId: string | null = null;
    let hackathonUrl: string | null = null;

    // Auto-create hackathon on approve
    if (newStatus === "approved" && proposal.hackathon_config) {
      const cfg = proposal.hackathon_config as {
        title?: string; brief?: string; rules?: string;
        deadline?: string; min_participants?: number; challenge_type?: string;
      };

      if (cfg.title && cfg.brief && cfg.deadline) {
        const endsAt = new Date(cfg.deadline);
        if (!isNaN(endsAt.getTime()) && endsAt.getTime() > Date.now()) {
          hackathonId = uuid();
          const { error: insertErr } = await supabaseAdmin
            .from("hackathons")
            .insert({
              id: hackathonId,
              title: cfg.title,
              description: `Enterprise hackathon by ${proposal.company}`,
              brief: cfg.brief,
              rules: cfg.rules || null,
              entry_type: "free",
              entry_fee: 0,
              prize_pool: 0,
              platform_fee_pct: 0.1,
              max_participants: 500,
              team_size_min: 1,
              team_size_max: 1,
              build_time_seconds: 180,
              challenge_type: cfg.challenge_type || "landing_page",
              status: "open",
              created_by: id,
              starts_at: new Date().toISOString(),
              ends_at: endsAt.toISOString(),
            });

          if (insertErr) {
            console.error("Auto hackathon creation failed:", insertErr);
            hackathonId = null;
          } else {
            hackathonUrl = `/hackathons/${hackathonId}`;
          }
        }
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from("enterprise_proposals")
      .update({
        status: hackathonId ? "hackathon_created" : newStatus,
        admin_notes: sanitize(body.notes, 2000) || (hackathonId ? `Hackathon auto-created: ${hackathonId}` : null),
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json({ success: false, error: { message: "Update failed" } }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id,
        status: hackathonId ? "hackathon_created" : newStatus,
        ...(hackathonId ? { hackathon_id: hackathonId, hackathon_url: hackathonUrl } : {}),
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: { message: "Invalid request" } }, { status: 400 });
  }
}
