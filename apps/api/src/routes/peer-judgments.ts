import type { FastifyInstance } from "fastify";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { enqueueJob } from "@buildersclaw/shared/queue";
import { isValidUUID } from "@buildersclaw/shared/validation";
import { ok, fail, unauthorized } from "../respond";
import { authFastify } from "../auth";

export async function peerJudgmentRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/hackathons/:id/peer-judgments", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const { id: hackathonId } = req.params as { id: string };
    if (!isValidUUID(hackathonId)) return fail(reply, "Invalid hackathon ID format", 400);

    const body = req.body as Record<string, unknown> || {};
    const submissionId = typeof body.submission_id === "string" ? body.submission_id : null;
    const totalScore = Number(body.total_score);
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";

    if (!submissionId || !isValidUUID(submissionId)) return fail(reply, "submission_id is required", 400);
    if (!Number.isFinite(totalScore)) return fail(reply, "total_score must be a number", 400);
    if (totalScore < 0 || totalScore > 100) return fail(reply, "total_score must be between 0 and 100", 400);
    if (!feedback) return fail(reply, "feedback is required", 400);
    if (feedback.length > 4000) return fail(reply, "feedback is too long. Max 4000 characters.", 400);

    const db = getDb();
    const [assignment] = await db
      .select({
        id: schema.peerJudgments.id,
        status: schema.peerJudgments.status,
        submission_hackathon_id: schema.submissions.hackathonId,
      })
      .from(schema.peerJudgments)
      .innerJoin(schema.submissions, eq(schema.peerJudgments.submissionId, schema.submissions.id))
      .where(and(eq(schema.peerJudgments.submissionId, submissionId), eq(schema.peerJudgments.reviewerAgentId, agent.id)))
      .limit(1);

    if (!assignment) return fail(reply, "Not assigned to review this submission", 403);
    if (assignment.submission_hackathon_id !== hackathonId) return fail(reply, "Submission does not belong to this hackathon", 400);
    if (assignment.status === "submitted") return fail(reply, "Already submitted this review", 409);
    if (assignment.status === "skipped") return fail(reply, "This review assignment has been skipped", 409);

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
            : hackathon.judging_criteria as Record<string, unknown>;
        } catch { /* ignore malformed metadata */ }
      }
      if (meta.peer_judging_closed_at) return fail(reply, "Peer judging phase has closed for this hackathon", 400);
    }

    const warnings: Record<string, unknown> = {};
    if (totalScore === 100 || totalScore === 0) warnings.extreme_score = true;

    try {
      await db.update(schema.peerJudgments).set({
        status: "submitted",
        totalScore: Math.round(totalScore),
        feedback,
        warnings: Object.keys(warnings).length > 0 ? warnings : null,
        submittedAt: new Date().toISOString(),
      }).where(eq(schema.peerJudgments.id, assignment.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown database error";
      return fail(reply, "Failed to submit peer review", 500, message);
    }

    const [pending] = await db
      .select({ total: count() })
      .from(schema.peerJudgments)
      .innerJoin(schema.submissions, eq(schema.peerJudgments.submissionId, schema.submissions.id))
      .where(and(eq(schema.peerJudgments.status, "assigned"), eq(schema.submissions.hackathonId, hackathonId)));

    if ((pending?.total ?? 0) === 0) {
      await enqueueJob({ type: "judging.close_peer_reviews", payload: { hackathon_id: hackathonId }, maxAttempts: 3 });
    }

    return ok(reply, { message: "Peer review submitted successfully" });
  });
}
