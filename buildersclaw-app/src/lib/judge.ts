import { supabaseAdmin } from "./supabase";
import { generateCode } from "./llm";
import { slugify } from "./github";
import { fetchRepoForJudging, formatRepoForPrompt, parseGitHubUrl } from "./repo-fetcher";
import { Hackathon, Submission } from "./types";
import {
  runGenLayerJudging,
  isGenLayerAvailable,
  type GenLayerContender,
} from "./genlayer";
import { isViableSubmission } from "./validation";

export interface EvaluationResult {
  functionality_score: number;
  brief_compliance_score: number;
  code_quality_score: number;
  architecture_score: number;
  innovation_score: number;
  completeness_score: number;
  documentation_score: number;
  testing_score: number;
  security_score: number;
  deploy_readiness_score: number;
  total_score: number;
  judge_feedback: string;
}

/**
 * Build a judge system prompt that is fully personalized to the enterprise's
 * problem description, judging criteria, rules, and challenge type.
 */
function buildJudgeSystemPrompt(hackathon: Hackathon): string {
  // Parse enterprise context from judging_criteria (may contain JSON with enterprise context)
  let enterpriseContext = "";
  let customCriteria = "";

  if (hackathon.judging_criteria) {
    try {
      const parsed = JSON.parse(hackathon.judging_criteria);
      if (parsed.enterprise_problem) {
        enterpriseContext = `\nORIGINAL ENTERPRISE PROBLEM:\n${parsed.enterprise_problem}\n`;
      }
      if (parsed.enterprise_requirements) {
        enterpriseContext += `\nENTERPRISE REQUIREMENTS:\n${parsed.enterprise_requirements}\n`;
      }
      if (parsed.criteria_text) {
        customCriteria = `\nCUSTOM JUDGING CRITERIA:\n${parsed.criteria_text}\n`;
      }
    } catch {
      // Not JSON — treat as plain text criteria
      customCriteria = `\nCUSTOM JUDGING CRITERIA:\n${hackathon.judging_criteria}\n`;
    }
  }

  return `You are an elite software engineering judge for an AI agent hackathon on BuildersClaw.

YOUR MISSION: Evaluate a code repository submission. You will receive the FULL source code of the submitted project. You must analyze the actual code quality, architecture, and whether it genuinely solves the stated problem.

═══ HACKATHON CONTEXT ═══
Title: ${hackathon.title}
Challenge Type: ${hackathon.challenge_type || "general"}
${enterpriseContext}
CHALLENGE BRIEF (what the enterprise/organizer asked for):
${hackathon.brief}

${hackathon.description ? `ADDITIONAL DESCRIPTION:\n${hackathon.description}\n` : ""}
${hackathon.rules ? `RULES & CONSTRAINTS:\n${hackathon.rules}\n` : ""}
${customCriteria}

═══ EVALUATION CRITERIA ═══
Score each criterion 0-100. Be strict and fair. 100 = exceptional, 70 = good, 50 = mediocre, below 30 = failing.

1. **functionality_score**: Does the code actually work? Does it implement the core features described in the brief?
2. **brief_compliance_score**: How well does the submission address the specific problem/requirements stated in the challenge brief? This is the MOST IMPORTANT criterion.
3. **code_quality_score**: Clean code, proper naming, no obvious bugs, follows language idioms and best practices.
4. **architecture_score**: Good project structure, separation of concerns, appropriate patterns, scalability considerations.
5. **innovation_score**: Creative approaches, clever solutions, use of modern tools/techniques, going beyond minimum requirements.
6. **completeness_score**: Is the project complete or half-done? Are there TODOs, placeholder code, missing features?
7. **documentation_score**: README quality, code comments where needed, setup instructions, API docs if applicable.
8. **testing_score**: Are there tests? Test coverage? Do they test meaningful scenarios?
9. **security_score**: No hardcoded secrets, input validation, proper auth patterns, no obvious vulnerabilities.
10. **deploy_readiness_score**: Could this be deployed? Proper configs, environment handling, build scripts, CI/CD?

═══ OUTPUT FORMAT ═══
Return ONLY a valid JSON object (no markdown fences, no commentary):
{
  "functionality_score": <0-100>,
  "brief_compliance_score": <0-100>,
  "code_quality_score": <0-100>,
  "architecture_score": <0-100>,
  "innovation_score": <0-100>,
  "completeness_score": <0-100>,
  "documentation_score": <0-100>,
  "testing_score": <0-100>,
  "security_score": <0-100>,
  "deploy_readiness_score": <0-100>,
  "judge_feedback": "2-4 paragraph detailed feedback explaining scores, highlighting strengths, identifying weaknesses, and providing actionable improvement suggestions. Reference specific files and code when possible."
}`;
}

/**
 * Build the user prompt with the actual repository content.
 */
function buildJudgeUserPrompt(repoContent: string, submission: Submission): string {
  const parts: string[] = [];

  parts.push("═══ SUBMISSION TO EVALUATE ═══\n");

  if (submission.preview_url) {
    parts.push(`Submitted Repo URL: ${submission.preview_url}`);
  }

  // Parse build_log for repo_url and notes
  try {
    const meta = JSON.parse(submission.build_log || "{}");
    if (meta.repo_url) parts.push(`Repository URL: ${meta.repo_url}`);
    if (meta.notes) parts.push(`Submitter Notes: ${meta.notes}`);
  } catch { /* ignore */ }

  parts.push("\n═══ REPOSITORY SOURCE CODE ═══\n");
  parts.push(repoContent);
  parts.push("\n═══ END OF SUBMISSION ═══");
  parts.push("\nEvaluate this submission now. Return ONLY the JSON object.");

  return parts.join("\n");
}

/**
 * Extract the repo URL from a submission.
 * Priority: build_log.repo_url > build_log.project_url > preview_url
 */
function getSubmissionRepoUrl(submission: Submission): string | null {
  // Try build_log first
  try {
    const meta = JSON.parse(submission.build_log || "{}");
    if (meta.repo_url && parseGitHubUrl(meta.repo_url)) return meta.repo_url;
    if (meta.project_url && parseGitHubUrl(meta.project_url)) return meta.project_url;
  } catch { /* ignore */ }

  // Try preview_url
  if (submission.preview_url && parseGitHubUrl(submission.preview_url)) {
    return submission.preview_url;
  }

  return null;
}

export async function judgeSubmission(
  submission: Submission,
  hackathon: Hackathon,
  teamSlug?: string,
): Promise<EvaluationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured for platform judging");
  }

  // ── Fetch repository code ──
  const repoUrl = getSubmissionRepoUrl(submission);
  let repoContent: string;

  if (repoUrl) {
    const analysis = await fetchRepoForJudging(repoUrl, 40, 200_000);
    repoContent = formatRepoForPrompt(analysis);
  } else if (submission.html_content) {
    // Fallback: inline HTML content (legacy submissions)
    repoContent = `[LEGACY SUBMISSION - Inline HTML Only]\n\n\`\`\`html\n${submission.html_content}\n\`\`\``;
  } else {
    repoContent = "[ERROR] No repository URL or code content provided in this submission.";
  }

  // ── Build prompts contextualized to the enterprise's problem ──
  const systemPrompt = buildJudgeSystemPrompt(hackathon);
  const userPrompt = buildJudgeUserPrompt(repoContent, submission);

  try {
    const result = await generateCode({
      provider: "gemini",
      apiKey,
      systemPrompt,
      userPrompt,
      maxTokens: 2048,
      temperature: 0.15, // Very low for consistent, deterministic judging
    });

    const jsonStr = result.text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as Omit<EvaluationResult, "total_score">;

    // Weighted total score: brief_compliance is worth 2x
    const weights = {
      functionality_score: 1.5,
      brief_compliance_score: 2.0,  // Most important
      code_quality_score: 1.0,
      architecture_score: 1.0,
      innovation_score: 0.8,
      completeness_score: 1.2,
      documentation_score: 0.6,
      testing_score: 0.8,
      security_score: 0.8,
      deploy_readiness_score: 0.7,
    };

    const weightedSum = Object.entries(weights).reduce((sum, [key, weight]) => {
      const score = (parsed as unknown as Record<string, number>)[key] || 0;
      return sum + score * weight;
    }, 0);

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const total_score = Math.round(weightedSum / totalWeight);

    return { ...parsed, total_score };
  } catch (error: unknown) {
    console.error("Judging failed for submission", submission.id, error);
    const errMsg = error instanceof Error ? error.message : String(error);

    return {
      functionality_score: 0,
      brief_compliance_score: 0,
      code_quality_score: 0,
      architecture_score: 0,
      innovation_score: 0,
      completeness_score: 0,
      documentation_score: 0,
      testing_score: 0,
      security_score: 0,
      deploy_readiness_score: 0,
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

  // ── Concurrency guard: atomically claim "judging" status ──
  if (hackathon.status === "completed") return true;

  // Try to claim — works from open, in_progress, OR judging (retry after failure)
  const { data: locked, error: lockErr } = await supabaseAdmin
    .from("hackathons")
    .update({ status: "judging" })
    .in("status", ["open", "in_progress", "judging"])
    .eq("id", hackathonId)
    .select("id")
    .single();

  if (lockErr || !locked) return true;

  // Parse existing judging metadata
  let updatedMeta: Record<string, unknown> = {};
  if (hackathon.judging_criteria) {
    try {
      updatedMeta = typeof hackathon.judging_criteria === "string"
        ? JSON.parse(hackathon.judging_criteria)
        : hackathon.judging_criteria;
    } catch { /* ignore */ }
  }

  try {
    const { data: allSubmissions } = await supabaseAdmin
      .from("submissions")
      .select("*, teams(name, status)")
      .eq("hackathon_id", hackathonId);

    if (!allSubmissions || allSubmissions.length === 0) {
      updatedMeta.notes = "Ended with 0 submissions.";
      updatedMeta.finalized_at = new Date().toISOString();
      await supabaseAdmin
        .from("hackathons")
        .update({ status: "completed", judging_criteria: updatedMeta })
        .eq("id", hackathonId);
      return true;
    }

    // ── SECURITY: Filter out non-viable submissions ──
    // Only judge submissions that have a valid repo URL and are completed.
    // Teams that never submitted (or submitted garbage) should not waste judge tokens.
    const viableSubmissions: typeof allSubmissions = [];
    const skippedSubmissions: Array<{ team_id: string; reason: string }> = [];

    for (const sub of allSubmissions) {
      const check = isViableSubmission(sub);
      if (check.viable) {
        viableSubmissions.push(sub);
      } else {
        skippedSubmissions.push({ team_id: sub.team_id, reason: check.reason });
        console.warn(
          `[JUDGE] Skipping submission ${sub.id} (team ${sub.team_id}): ${check.reason}`
        );

        // Record a zero-score evaluation for skipped submissions
        await supabaseAdmin
          .from("evaluations")
          .upsert({
            submission_id: sub.id,
            functionality_score: 0, brief_compliance_score: 0, code_quality_score: 0,
            architecture_score: 0, innovation_score: 0, completeness_score: 0,
            documentation_score: 0, testing_score: 0, security_score: 0,
            deploy_readiness_score: 0, total_score: 0,
            judge_feedback: `Submission skipped: ${check.reason}. Teams must submit a valid GitHub repository URL to be judged.`,
            raw_response: JSON.stringify({ skipped: true, reason: check.reason }),
          }, { onConflict: "submission_id" });
      }
    }

    if (viableSubmissions.length === 0) {
      updatedMeta.notes = `Ended with ${allSubmissions.length} submissions but none had viable repos. ${skippedSubmissions.map(s => s.reason).join("; ")}`;
      updatedMeta.finalized_at = new Date().toISOString();
      updatedMeta.skipped_submissions = skippedSubmissions;
      await supabaseAdmin
        .from("hackathons")
        .update({ status: "completed", judging_criteria: updatedMeta })
        .eq("id", hackathonId);
      return true;
    }

    const submissions = viableSubmissions;
    if (skippedSubmissions.length > 0) {
      updatedMeta.skipped_submissions = skippedSubmissions;
      console.log(`[JUDGE] ${viableSubmissions.length} viable / ${skippedSubmissions.length} skipped out of ${allSubmissions.length} total submissions`);
    }

    // Judge all submissions (with per-submission error handling)
    const evaluationsToUpsert = [];
    for (const submission of submissions) {
      try {
        const teamData = submission.teams as { name?: string } | undefined;
        const teamSlug = teamData?.name ? slugify(teamData.name) : undefined;
        const result = await judgeSubmission(submission, hackathon, teamSlug);

        evaluationsToUpsert.push({
          submission_id: submission.id,
          functionality_score: result.functionality_score,
          brief_compliance_score: result.brief_compliance_score,
          code_quality_score: result.code_quality_score,
          architecture_score: result.architecture_score,
          innovation_score: result.innovation_score,
          completeness_score: result.completeness_score,
          documentation_score: result.documentation_score,
          testing_score: result.testing_score,
          security_score: result.security_score,
          deploy_readiness_score: result.deploy_readiness_score,
          total_score: result.total_score,
          judge_feedback: result.judge_feedback,
          raw_response: JSON.stringify(result),
        });
      } catch (subErr: unknown) {
        const msg = subErr instanceof Error ? subErr.message : String(subErr);
        console.error(`Judge error for submission ${submission.id}:`, msg);
        evaluationsToUpsert.push({
          submission_id: submission.id,
          functionality_score: 0, brief_compliance_score: 0, code_quality_score: 0,
          architecture_score: 0, innovation_score: 0, completeness_score: 0,
          documentation_score: 0, testing_score: 0, security_score: 0,
          deploy_readiness_score: 0, total_score: 0,
          judge_feedback: `Evaluation failed: ${msg}`,
          raw_response: JSON.stringify({ error: msg }),
        });
      }
    }

    if (evaluationsToUpsert.length > 0) {
      await supabaseAdmin
        .from("evaluations")
        .upsert(evaluationsToUpsert, { onConflict: "submission_id" });
    }

    // Determine winner: top 3 from Gemini → GenLayer on-chain consensus
    evaluationsToUpsert.sort((a, b) => b.total_score - a.total_score);

    // ── GenLayer impartial judging for top contenders ──
    const TOP_N = 3;
    const topEvals = evaluationsToUpsert
      .filter((e) => e.total_score > 0)
      .slice(0, TOP_N);

    let winnerTeamId: string | null = null;
    let winnerAgentId: string | null = null;
    let genlayerUsed = false;

    // Only use GenLayer if there are 2+ viable contenders and GenLayer is reachable
    if (topEvals.length >= 2 && (await isGenLayerAvailable())) {
      try {
        // Build contender data for GenLayer — exhaustive descriptions
        const contenders: GenLayerContender[] = [];
        for (const ev of topEvals) {
          const sub = submissions.find((s) => s.id === ev.submission_id);
          if (!sub) continue;
          const teamData = sub.teams as { name?: string } | undefined;
          const repoUrl = getSubmissionRepoUrl(sub);

          // Fetch repo content again for the summary (GenLayer needs it)
          let repoSummary = "";
          if (repoUrl) {
            try {
              const analysis = await fetchRepoForJudging(repoUrl, 30, 50_000);
              repoSummary = formatRepoForPrompt(analysis);
            } catch {
              repoSummary = `Repo: ${repoUrl} (could not fetch)`;
            }
          }

          contenders.push({
            team_id: sub.team_id,
            team_name: teamData?.name || sub.team_id,
            repo_url: repoUrl || "",
            repo_summary: repoSummary,
            gemini_score: ev.total_score,
            gemini_feedback: (ev.judge_feedback || "").slice(0, 2000),
          });
        }

        if (contenders.length >= 2) {
          console.log(`GenLayer: sending ${contenders.length} top contenders for on-chain judging`);

          const glResult = await runGenLayerJudging(
            hackathonId,
            hackathon.title,
            hackathon.brief,
            contenders,
          );

          if (glResult.finalized && glResult.winner_team_id) {
            winnerTeamId = glResult.winner_team_id;
            genlayerUsed = true;
            updatedMeta.genlayer_result = glResult;
            updatedMeta.genlayer_reasoning = glResult.reasoning;
            console.log(`GenLayer: winner is ${glResult.winner_team_name} (${glResult.winner_team_id})`);

            // ── Save GenLayer score into evaluations so the leaderboard picks it up ──
            if (glResult.final_score) {
              const winnerSub = submissions.find((s) => s.team_id === glResult.winner_team_id);
              if (winnerSub) {
                // Update the winner's evaluation with GenLayer's final score + reasoning
                const glFeedback = `🔗 GenLayer On-Chain Verdict (5 validators):\n` +
                  `Final Score: ${glResult.final_score}/100\n` +
                  `${glResult.reasoning || ""}`;

                await supabaseAdmin
                  .from("evaluations")
                  .update({
                    total_score: glResult.final_score,
                    judge_feedback: glFeedback,
                    raw_response: JSON.stringify({
                      ...JSON.parse(
                        evaluationsToUpsert.find((e) => e.submission_id === winnerSub.id)?.raw_response || "{}"
                      ),
                      genlayer_result: glResult,
                    }),
                  })
                  .eq("submission_id", winnerSub.id);

                // Also update our in-memory array so the rest of the flow is consistent
                const idx = evaluationsToUpsert.findIndex((e) => e.submission_id === winnerSub.id);
                if (idx >= 0) {
                  evaluationsToUpsert[idx].total_score = glResult.final_score;
                  evaluationsToUpsert[idx].judge_feedback = glFeedback;
                }

                console.log(`GenLayer: saved final_score=${glResult.final_score} to evaluations for ${winnerSub.id}`);
              }
            }
          }
        }
      } catch (glErr) {
        console.error("GenLayer judging failed, falling back to Gemini ranking:", glErr);
        // Fall through to Gemini-only winner selection below
      }
    }

    // Fallback: if GenLayer didn't run or failed, use Gemini's top scorer
    if (!winnerTeamId) {
      const winningEval = evaluationsToUpsert[0];
      const winningSub = submissions.find((s) => s.id === winningEval.submission_id);
      if (winningSub && winningEval.total_score > 0) {
        winnerTeamId = winningSub.team_id;
      }
    }

    // Resolve winner agent
    if (winnerTeamId) {
      const { data: teamMembers } = await supabaseAdmin
        .from("team_members")
        .select("agent_id")
        .eq("team_id", winnerTeamId)
        .eq("role", "leader")
        .single();

      if (teamMembers?.agent_id) {
        winnerAgentId = teamMembers.agent_id;
        updatedMeta.winner_agent_id = winnerAgentId;
        updatedMeta.winner_team_id = winnerTeamId;
      }
    }

    updatedMeta.finalized_at = new Date().toISOString();
    updatedMeta.judge_method = genlayerUsed ? "gemini+genlayer" : "gemini";
    updatedMeta.notes = genlayerUsed
      ? `Gemini pre-scored ${submissions.length} submissions. Top ${topEvals.length} went to GenLayer on-chain consensus. Winner verified by 5 independent validators.`
      : submissions.length === 1
        ? "Won by default (only participant). Judged for feedback."
        : "Automatically judged by Gemini AI. Code repositories were analyzed.";

    await supabaseAdmin
      .from("hackathons")
      .update({ status: "completed", judging_criteria: updatedMeta })
      .eq("id", hackathonId);

    return true;
  } catch (err) {
    // On unexpected failure, revert to in_progress so cron can retry
    console.error(`judgeHackathon(${hackathonId}) fatal error, reverting status:`, err);
    await supabaseAdmin
      .from("hackathons")
      .update({ status: "in_progress" })
      .eq("id", hackathonId)
      .eq("status", "judging");
    throw err;
  }
}
