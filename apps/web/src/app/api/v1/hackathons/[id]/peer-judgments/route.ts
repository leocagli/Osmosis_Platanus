import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { error as errorResponse, success } from "@/lib/responses";
import { enqueueJob } from "@/lib/queue";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await authenticateRequest(req);
  if (!agent) {
    return errorResponse("Unauthorized", 401);
  }

  const { id: hackathonId } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { submission_id, total_score, feedback } = body;
  if (!submission_id || typeof total_score !== "number" || typeof feedback !== "string") {
    return errorResponse("Missing or invalid fields: submission_id, total_score, feedback", 400);
  }

  if (total_score < 0 || total_score > 100) {
    return errorResponse("total_score must be between 0 and 100", 400);
  }

  // Validate peer judgment assignment
  const { data: assignment } = await supabaseAdmin
    .from("peer_judgments")
    .select("*, submissions!inner(hackathon_id)")
    .eq("submission_id", submission_id)
    .eq("reviewer_agent_id", agent.id)
    .single();

  if (!assignment) {
    return errorResponse("Not assigned to review this submission", 403);
  }

  if (assignment.submissions.hackathon_id !== hackathonId) {
    return errorResponse("Submission does not belong to this hackathon", 400);
  }

  if (assignment.status === "submitted") {
    return errorResponse("Already submitted this review", 400);
  }

  // Check if hackathon judging is closed
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("judging_criteria")
    .eq("id", hackathonId)
    .single();

  if (hackathon) {
    let meta: Record<string, unknown> = {};
    if (hackathon.judging_criteria) {
      try {
        meta = typeof hackathon.judging_criteria === "string" 
          ? JSON.parse(hackathon.judging_criteria) 
          : hackathon.judging_criteria;
      } catch { /* ignore */ }
    }
    if (meta.peer_judging_closed_at) {
      return errorResponse("Peer judging phase has closed for this hackathon", 400);
    }
  }

  const warnings: Record<string, unknown> = {};
  if (total_score === 100 || total_score === 0) {
    warnings.extreme_score = true;
  }

  const { error } = await supabaseAdmin
    .from("peer_judgments")
    .update({
      status: "submitted",
      total_score,
      feedback,
      warnings: Object.keys(warnings).length > 0 ? warnings : null,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", assignment.id);

  if (error) {
    return errorResponse("Failed to submit peer review", 500, error.message);
  }

  // Early close logic: check if all assigned reviews for this hackathon are submitted
  const { count: pendingCount } = await supabaseAdmin
    .from("peer_judgments")
    .select("id", { count: "exact", head: true })
    .eq("status", "assigned")
    .eq("submissions.hackathon_id", hackathonId)
    .not("submissions", "is", null);

  if (pendingCount === 0) {
    await enqueueJob({
      type: "judging.close_peer_reviews",
      payload: { hackathon_id: hackathonId },
      maxAttempts: 3,
    });
  }

  return success({ message: "Peer review submitted successfully" });
}
