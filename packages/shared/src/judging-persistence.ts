import { and, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Evaluation, PeerJudgment, DeploymentCheck } from "./types";

export interface FinalistEvidence {
  peer_score: number;
  repo_score: number;
  runtime_score: number;
  finalist_score: number;
  warnings: string[];
}

export async function persistPeerJudgment(
  submissionId: string,
  reviewerAgentId: string,
  updates: Partial<Omit<PeerJudgment, "id" | "submission_id" | "reviewer_agent_id">>
) {
  const set: Partial<typeof schema.peerJudgments.$inferInsert> = {};
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.total_score !== undefined) set.totalScore = updates.total_score;
  if (updates.feedback !== undefined) set.feedback = updates.feedback;
  if (updates.warnings !== undefined) set.warnings = updates.warnings;
  if (updates.assigned_at !== undefined) set.assignedAt = updates.assigned_at;
  if (updates.submitted_at !== undefined) set.submittedAt = updates.submitted_at;

  if (Object.keys(set).length === 0) {
    return;
  }

  try {
    await getDb()
      .update(schema.peerJudgments)
      .set(set)
      .where(
        and(
          eq(schema.peerJudgments.submissionId, submissionId),
          eq(schema.peerJudgments.reviewerAgentId, reviewerAgentId)
        )
      );
  } catch (error) {
    throw new Error(`Failed to persist peer judgment: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function persistDeploymentCheck(
  submissionId: string,
  updates: Partial<Omit<DeploymentCheck, "id" | "submission_id">>
) {
  const set: Partial<typeof schema.deploymentChecks.$inferInsert> = {};
  if (updates.url_checked !== undefined) set.urlChecked = updates.url_checked;
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.runtime_score !== undefined) set.runtimeScore = updates.runtime_score;
  if (updates.summary !== undefined) set.summary = updates.summary;
  if (updates.raw_evidence !== undefined) set.rawEvidence = updates.raw_evidence;
  if (updates.warnings !== undefined) set.warnings = updates.warnings;
  if (updates.checked_at !== undefined) set.checkedAt = updates.checked_at;

  if (Object.keys(set).length === 0) {
    return;
  }

  try {
    await getDb()
      .update(schema.deploymentChecks)
      .set(set)
      .where(eq(schema.deploymentChecks.submissionId, submissionId));
  } catch (error) {
    throw new Error(`Failed to persist deployment check: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function persistComponentScoresAndEvidence(
  submissionId: string,
  finalistEvidence: FinalistEvidence
) {
  const db = getDb();
  const [existingEval] = await db
    .select({ rawResponse: schema.evaluations.rawResponse })
    .from(schema.evaluations)
    .where(eq(schema.evaluations.submissionId, submissionId))
    .limit(1);

  let rawResponse: Record<string, unknown> = {};
  if (existingEval?.rawResponse) {
    try {
      rawResponse = JSON.parse(existingEval.rawResponse);
    } catch {
      rawResponse = {};
    }
  }

  rawResponse.finalist_evidence = finalistEvidence;

  try {
    await db
      .update(schema.evaluations)
      .set({
        totalScore: finalistEvidence.finalist_score,
        rawResponse: JSON.stringify(rawResponse),
      })
      .where(eq(schema.evaluations.submissionId, submissionId));
  } catch (error) {
    throw new Error(`Failed to persist component scores: ${error instanceof Error ? error.message : String(error)}`);
  }
}
