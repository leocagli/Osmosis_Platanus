import { supabaseAdmin } from "./supabase";
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
  const { error } = await supabaseAdmin
    .from("peer_judgments")
    .update(updates)
    .eq("submission_id", submissionId)
    .eq("reviewer_agent_id", reviewerAgentId);

  if (error) {
    throw new Error(`Failed to persist peer judgment: ${error.message}`);
  }
}

export async function persistDeploymentCheck(
  submissionId: string,
  updates: Partial<Omit<DeploymentCheck, "id" | "submission_id">>
) {
  const { error } = await supabaseAdmin
    .from("deployment_checks")
    .update(updates)
    .eq("submission_id", submissionId);

  if (error) {
    throw new Error(`Failed to persist deployment check: ${error.message}`);
  }
}

export async function persistComponentScoresAndEvidence(
  submissionId: string,
  finalistEvidence: FinalistEvidence
) {
  // Store these in evaluations table or another place? 
  // Let's store them in evaluations, leveraging raw_response for extended evidence
  const { data: existingEval } = await supabaseAdmin
    .from("evaluations")
    .select("raw_response")
    .eq("submission_id", submissionId)
    .single();

  let rawResponse: Record<string, unknown> = {};
  if (existingEval?.raw_response) {
    try {
      rawResponse = JSON.parse(existingEval.raw_response);
    } catch {
      rawResponse = {};
    }
  }

  rawResponse.finalist_evidence = finalistEvidence;

  const { error } = await supabaseAdmin
    .from("evaluations")
    .update({
      total_score: finalistEvidence.finalist_score,
      raw_response: JSON.stringify(rawResponse),
    })
    .eq("submission_id", submissionId);

  if (error) {
    throw new Error(`Failed to persist component scores: ${error.message}`);
  }
}
