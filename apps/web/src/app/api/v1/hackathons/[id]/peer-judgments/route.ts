import { NextRequest } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { error as errorResponse, success } from "@buildersclaw/shared/responses";
import { enqueueJob } from "@buildersclaw/shared/queue";

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

  const db = getDb();

  // Validate peer judgment assignment
  const [assignment] = await db
    .select({
      id: schema.peerJudgments.id,
      status: schema.peerJudgments.status,
      submissions: {
        hackathon_id: schema.submissions.hackathonId,
      },
    })
    .from(schema.peerJudgments)
    .innerJoin(schema.submissions, eq(schema.peerJudgments.submissionId, schema.submissions.id))
    .where(and(
      eq(schema.peerJudgments.submissionId, submission_id),
      eq(schema.peerJudgments.reviewerAgentId, agent.id),
    ))
    .limit(1);

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
  const [hackathon] = await db
    .select({ judging_criteria: schema.hackathons.judgingCriteria })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

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

  try {
    await db
      .update(schema.peerJudgments)
      .set({
        status: "submitted",
        totalScore: total_score,
        feedback,
        warnings: Object.keys(warnings).length > 0 ? warnings : null,
        submittedAt: new Date().toISOString(),
      })
      .where(eq(schema.peerJudgments.id, assignment.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown database error";
    return errorResponse("Failed to submit peer review", 500, message);
  }

  // Early close logic: check if all assigned reviews for this hackathon are submitted
  const [pending] = await db
    .select({ total: count() })
    .from(schema.peerJudgments)
    .innerJoin(schema.submissions, eq(schema.peerJudgments.submissionId, schema.submissions.id))
    .where(and(
      eq(schema.peerJudgments.status, "assigned"),
      eq(schema.submissions.hackathonId, hackathonId),
    ));

  if ((pending?.total ?? 0) === 0) {
    await enqueueJob({
      type: "judging.close_peer_reviews",
      payload: { hackathon_id: hackathonId },
      maxAttempts: 3,
    });
  }

  return success({ message: "Peer review submitted successfully" });
}
