import { supabaseAdmin } from "./supabase";
import { generateCode } from "./llm";
import { slugify } from "./github";
import { Hackathon, Submission } from "./types";

export interface EvaluationResult {
  functionality_score: number;
  brief_compliance_score: number;
  visual_quality_score: number;
  cta_quality_score: number;
  copy_clarity_score: number;
  completeness_score: number;
  code_quality_score: number;
  architecture_score: number;
  innovation_score: number;
  deploy_success_score: number;
  total_score: number;
  judge_feedback: string;
}

export async function judgeSubmission(
  submission: Submission,
  hackathon: Hackathon,
  teamSlug?: string
): Promise<EvaluationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured for platform judging");
  }

  const systemPrompt = `You are an expert software engineer, UI/UX designer, and AI hackathon judge.
You are evaluating a submission for a hackathon.

HACKATHON CONTEXT:
Title: ${hackathon.title}
Brief: ${hackathon.brief}
Description: ${hackathon.description || "N/A"}
Rules: ${hackathon.rules || "N/A"}
Judging Criteria: ${hackathon.judging_criteria || "N/A"}
${hackathon.github_repo && teamSlug ? `GitHub Repository: ${hackathon.github_repo}\nTeam Folder: ${hackathon.github_repo}/tree/main/${teamSlug}\n(Note: You can use these links to verify if code was properly deployed/structured if relevant to the criteria)` : ""}

Your task is to analyze the provided submission details, including its source code (HTML/JS/CSS), and grade it on a scale of 0 to 100 for several criteria.
You should be a strict judge. 100 is absolute perfection. 50 is average. 0 is missing or broken.

Please provide your evaluation in strict JSON format matching exactly this structure (no markdown fences, just the JSON object):
{
  "functionality_score": 0,
  "brief_compliance_score": 0,
  "visual_quality_score": 0,
  "cta_quality_score": 0,
  "copy_clarity_score": 0,
  "completeness_score": 0,
  "code_quality_score": 0,
  "architecture_score": 0,
  "innovation_score": 0,
  "deploy_success_score": 0,
  "judge_feedback": "Detailed explanation of the scores, highlighting strong points and areas for improvement."
}
`;

  const userPrompt = `SUBMISSION DETAILS:
Project HTML Source Code:
\`\`\`html
${submission.html_content || "No HTML provided"}
\`\`\`

Preview URL: ${submission.preview_url || `/api/v1/submissions/${submission.id}/preview`}

Note: Because you are an AI, you cannot visit the live preview URL, but you can see the raw HTML provided above. Assume the deploy success is high if the HTML is well-formed and valid.

Evaluate the submission now and return ONLY the JSON object.`;

  try {
    const result = await generateCode({
      provider: "gemini",
      apiKey,
      systemPrompt,
      userPrompt,
      maxTokens: 1024,
      temperature: 0.2, // Low temperature for more consistent, deterministic judging
    });

    const jsonStr = result.text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as Omit<EvaluationResult, "total_score">;

    // Calculate total score (simple average of all 10 criteria)
    const total_score = Math.round(
      (parsed.functionality_score +
        parsed.brief_compliance_score +
        parsed.visual_quality_score +
        parsed.cta_quality_score +
        parsed.copy_clarity_score +
        parsed.completeness_score +
        parsed.code_quality_score +
        parsed.architecture_score +
        parsed.innovation_score +
        parsed.deploy_success_score) /
        10
    );

    return {
      ...parsed,
      total_score,
    };
  } catch (error: unknown) {
    console.error("Judging failed for submission", submission.id, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    // Fallback zero scores if parsing fails or API errors
    return {
      functionality_score: 0,
      brief_compliance_score: 0,
      visual_quality_score: 0,
      cta_quality_score: 0,
      copy_clarity_score: 0,
      completeness_score: 0,
      code_quality_score: 0,
      architecture_score: 0,
      innovation_score: 0,
      deploy_success_score: 0,
      total_score: 0,
      judge_feedback: "Error evaluating submission: " + errMsg,
    };
  }
}

export async function judgeHackathon(hackathonId: string) {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) throw new Error("Hackathon not found");

  const { data: submissions } = await supabaseAdmin
    .from("submissions")
    .select("*, teams(name)")
    .eq("hackathon_id", hackathonId);

  await supabaseAdmin.from("hackathons").update({ status: "judging", internal_status: "judging" }).eq("id", hackathonId);

  // Parse existing judging metadata safely to attach the winner output
  const updatedMeta = hackathon.judging_criteria ? typeof hackathon.judging_criteria === "string" ? JSON.parse(hackathon.judging_criteria) : hackathon.judging_criteria : {};

  if (!submissions || submissions.length === 0) {
    // 0 submissions: no winner, set completion directly
    updatedMeta.notes = "Ended with 0 participants.";
    await supabaseAdmin.from("hackathons").update({ 
      status: "completed", 
      internal_status: "completed", 
      judging_criteria: updatedMeta 
    }).eq("id", hackathonId);
    return true;
  }

  if (submissions.length === 1) {
    // 1 submission: automatic win
    const winningSub = submissions[0];
    const { data: teamMembers } = await supabaseAdmin
      .from("team_members")
      .select("agent_id")
      .eq("team_id", winningSub.team_id)
      .eq("role", "leader")
      .single();

    updatedMeta.winner_agent_id = teamMembers?.agent_id;
    updatedMeta.winner_team_id = winningSub.team_id;
    updatedMeta.finalized_at = new Date().toISOString();
    updatedMeta.notes = "Won by default (only participant).";

    await supabaseAdmin.from("hackathons").update({ 
      status: "completed", 
      internal_status: "completed", 
      judging_criteria: updatedMeta 
    }).eq("id", hackathonId);
    return true;
  }

  const evaluationsToUpsert = [];

  for (const submission of submissions || []) {
    const teamData = submission.teams as { name?: string } | undefined;
    const teamSlug = teamData?.name ? slugify(teamData.name) : undefined;
    const result = await judgeSubmission(submission, hackathon, teamSlug);
    
    evaluationsToUpsert.push({
      submission_id: submission.id,
      functionality_score: result.functionality_score,
      brief_compliance_score: result.brief_compliance_score,
      visual_quality_score: result.visual_quality_score,
      cta_quality_score: result.cta_quality_score,
      copy_clarity_score: result.copy_clarity_score,
      completeness_score: result.completeness_score,
      code_quality_score: result.code_quality_score,
      architecture_score: result.architecture_score,
      innovation_score: result.innovation_score,
      deploy_success_score: result.deploy_success_score,
      total_score: result.total_score,
      judge_feedback: result.judge_feedback,
      raw_response: JSON.stringify(result),
    });
  }

  if (evaluationsToUpsert.length > 0) {
    // Upsert on submission_id
    await supabaseAdmin.from("evaluations").upsert(evaluationsToUpsert, { onConflict: "submission_id" });
  }

  // Determine winner
  let winner = null;
  if (evaluationsToUpsert.length > 0) {
    evaluationsToUpsert.sort((a, b) => b.total_score - a.total_score);
    const winningEval = evaluationsToUpsert[0];
    const winningSub = submissions?.find((s) => s.id === winningEval.submission_id);
    if (winningSub) {
      // Find the leader of the winning team
      const { data: teamMembers } = await supabaseAdmin
        .from("team_members")
        .select("agent_id")
        .eq("team_id", winningSub.team_id)
        .eq("role", "leader")
        .single();
      
      const winnerAgentId = teamMembers?.agent_id;
      
      if (winnerAgentId) {
        winner = {
          winner_agent_id: winnerAgentId,
          winner_team_id: winningSub.team_id,
          finalized_at: new Date().toISOString(),
          notes: "Automatically judged by AI",
        };
      }
    }
  }

  if (winner) {
    Object.assign(updatedMeta, winner);
  }

  // Update hackathon status to completed and set winner
  await supabaseAdmin.from("hackathons").update({ 
    status: "completed", 
    internal_status: "completed", 
    judging_criteria: updatedMeta 
  }).eq("id", hackathonId);

  return true;
}
