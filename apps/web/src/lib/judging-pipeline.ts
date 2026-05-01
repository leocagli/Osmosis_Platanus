import { supabaseAdmin } from "./supabase";
import { enqueueJob } from "./queue";
import { updateActiveJudgingRunForHackathon } from "./judging-runs";
import { isViableSubmission } from "./validation";
import type { Hackathon, Submission, JudgingRunMetadata } from "./types";

export async function freezeSubmissions(hackathonId: string, judgingRunId: string) {
  await updateActiveJudgingRunForHackathon(hackathonId, "running");

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("status, judging_criteria")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) throw new Error("Hackathon not found");
  if (hackathon.status === "completed") {
    await updateActiveJudgingRunForHackathon(hackathonId, "completed");
    return;
  }

  // Atomically claim "judging" status
  const { data: locked } = await supabaseAdmin
    .from("hackathons")
    .update({ status: "judging" })
    .in("status", ["open", "in_progress", "judging"])
    .eq("id", hackathonId)
    .select("id")
    .single();

  if (!locked) return; // another worker got it

  let meta: JudgingRunMetadata = {};
  if (hackathon.judging_criteria) {
    try {
      meta = typeof hackathon.judging_criteria === "string" 
        ? JSON.parse(hackathon.judging_criteria) 
        : hackathon.judging_criteria;
    } catch { /* ignore */ }
  }

  // Freeze submissions (just read them)
  const { data: allSubmissions } = await supabaseAdmin
    .from("submissions")
    .select("*, teams(name, status)")
    .eq("hackathon_id", hackathonId);

  if (!allSubmissions || allSubmissions.length === 0) {
    meta.notes = "Ended with 0 submissions.";
    meta.finalized_at = new Date().toISOString();
    await supabaseAdmin
      .from("hackathons")
      .update({ status: "completed", judging_criteria: meta as Record<string, unknown> })
      .eq("id", hackathonId);
    await updateActiveJudgingRunForHackathon(hackathonId, "completed", { metadata: { submissions_judged: 0 } });
    return;
  }

  const viableSubmissions = [];
  const skippedSubmissions = [];

  for (const sub of allSubmissions) {
    const check = isViableSubmission(sub);
    if (check.viable) {
      viableSubmissions.push(sub);
    } else {
      skippedSubmissions.push({ team_id: sub.team_id, reason: check.reason });
      // Record a zero-score evaluation for skipped submissions
      await supabaseAdmin.from("evaluations").upsert({
        submission_id: sub.id,
        total_score: 0,
        judge_feedback: `Submission skipped: ${check.reason}.`,
        raw_response: JSON.stringify({ skipped: true, reason: check.reason }),
      }, { onConflict: "submission_id" });
    }
  }

  if (viableSubmissions.length === 0) {
    meta.notes = `Ended with ${allSubmissions.length} submissions but none had viable repos.`;
    meta.finalized_at = new Date().toISOString();
    meta.skipped_submissions = skippedSubmissions;
    await supabaseAdmin
      .from("hackathons")
      .update({ status: "completed", judging_criteria: meta as Record<string, unknown> })
      .eq("id", hackathonId);
    await updateActiveJudgingRunForHackathon(hackathonId, "completed", { metadata: { submissions_judged: 0, skipped_submissions: skippedSubmissions } });
    return;
  }

  meta.skipped_submissions = skippedSubmissions;
  meta.submissions_judged = viableSubmissions.length;
  await supabaseAdmin
    .from("hackathons")
    .update({ judging_criteria: meta as Record<string, unknown> })
    .eq("id", hackathonId);

  // Enqueue the next steps in the pipeline for EACH submission
  for (const sub of viableSubmissions) {
    await enqueueJob({
      type: "judging.repo_score",
      payload: { hackathon_id: hackathonId, submission_id: sub.id },
      maxAttempts: 3,
    });
    
    await enqueueJob({
      type: "judging.runtime_score",
      payload: { hackathon_id: hackathonId, submission_id: sub.id },
      maxAttempts: 3,
    });
  }

  // Assign peer reviews for the hackathon
  await enqueueJob({
    type: "judging.assign_peer_reviews",
    payload: { hackathon_id: hackathonId },
    maxAttempts: 3,
  });

  // Close peer reviews later (e.g. 2 hours later)
  const peerWindowHours = meta.peer_review_window_hours || 2;
  await enqueueJob({
    type: "judging.close_peer_reviews",
    payload: { hackathon_id: hackathonId },
    runAt: new Date(Date.now() + peerWindowHours * 60 * 60 * 1000),
    maxAttempts: 3,
  });
}

export async function repoScore(hackathonId: string, submissionId: string) {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  const { data: submission } = await supabaseAdmin
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single();

  if (!hackathon || !submission) return;

  try {
    const { judgeSubmission } = await import("./judge");
    const result = await judgeSubmission(submission as Submission, hackathon as Hackathon);

    await supabaseAdmin
      .from("evaluations")
      .upsert({
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
      }, { onConflict: "submission_id" });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`repoScore failed for ${submissionId}:`, msg);
    await supabaseAdmin
      .from("evaluations")
      .upsert({
        submission_id: submission.id,
        total_score: 0,
        judge_feedback: `Evaluation failed: ${msg}`,
        raw_response: JSON.stringify({ error: msg }),
      }, { onConflict: "submission_id" });
  }
}

export async function runtimeScore(hackathonId: string, submissionId: string) {
  const { data: submission } = await supabaseAdmin
    .from("submissions")
    .select("preview_url, project_url")
    .eq("id", submissionId)
    .single();

  if (!submission) return;

  const urlStr = submission.preview_url || submission.project_url;
  
  if (!urlStr) {
    const { persistDeploymentCheck } = await import("./judging-persistence");
    await persistDeploymentCheck(submissionId, {
      url_checked: "none",
      status: "failed",
      runtime_score: 0,
      summary: "No deployed URL provided",
      raw_evidence: null,
      warnings: { missing_url: true }
    });
    return;
  }

  const { checkDeploymentUrl } = await import("./runtime-checker");
  const result = await checkDeploymentUrl(urlStr);

  let runtime_score = 0;
  if (result.status === "success") {
    // Basic scoring logic based on status and content
    runtime_score = 100;
    if (result.warnings.length > 0) {
      runtime_score -= (result.warnings.length * 10);
    }
  } else if (result.status === "timeout") {
    runtime_score = 20; // Partial score for attempting, but failing to load
  } else {
    runtime_score = 0;
  }

  runtime_score = Math.max(0, Math.min(100, runtime_score));

  const { persistDeploymentCheck } = await import("./judging-persistence");
  
  // Convert warnings array to a record
  const warningsRecord = result.warnings.length > 0 
    ? { issues: result.warnings } 
    : null;

  try {
    await persistDeploymentCheck(submissionId, {
      url_checked: urlStr,
      status: result.status,
      runtime_score,
      summary: result.text_summary || null,
      raw_evidence: {
        http_status: result.http_status,
        redirects: result.redirects,
        page_title: result.page_title,
      },
      warnings: warningsRecord
    });
  } catch (err: unknown) {
    // If updating fails because the row doesn't exist, we need to insert it
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Failed to persist") || msg.includes("row not found")) {
      await supabaseAdmin.from("deployment_checks").upsert({
        submission_id: submissionId,
        url_checked: urlStr,
        status: result.status,
        runtime_score,
        summary: result.text_summary || null,
        raw_evidence: {
          http_status: result.http_status,
          redirects: result.redirects,
          page_title: result.page_title,
        },
        warnings: warningsRecord
      }, { onConflict: "submission_id" });
    }
  }
}

export async function assignPeerReviews(hackathonId: string) {
  const { data: submissions } = await supabaseAdmin
    .from("submissions")
    .select("id, team_id")
    .eq("hackathon_id", hackathonId)
    .eq("status", "completed");

  if (!submissions || submissions.length === 0) return;

  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("id, team_members(agent_id, status)")
    .eq("hackathon_id", hackathonId);

  if (!teams) return;

  const eligibleReviewers: { agent_id: string; team_id: string; review_count: number }[] = [];

  for (const sub of submissions) {
    const team = teams.find(t => t.id === sub.team_id);
    if (!team) continue;
    const members = team.team_members || [];
    for (const m of members) {
      if (m.status === "active") {
        eligibleReviewers.push({ agent_id: m.agent_id, team_id: team.id, review_count: 0 });
      }
    }
  }

  // Shuffle reviewers
  for (let i = eligibleReviewers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligibleReviewers[i], eligibleReviewers[j]] = [eligibleReviewers[j], eligibleReviewers[i]];
  }

  const assignmentsToInsert = [];

  for (const sub of submissions) {
    let assignmentsForSub = 0;

    // Try to assign 3 reviewers
    for (const reviewer of eligibleReviewers) {
      if (assignmentsForSub >= 3) break;
      if (reviewer.team_id === sub.team_id) continue; // Skip own team
      
      // Prefer reviewers with fewer assignments
      if (reviewer.review_count < 3) {
        assignmentsToInsert.push({
          submission_id: sub.id,
          reviewer_agent_id: reviewer.agent_id,
          status: "assigned",
        });
        reviewer.review_count++;
        assignmentsForSub++;
      }
    }
  }

  if (assignmentsToInsert.length > 0) {
    await supabaseAdmin.from("peer_judgments").upsert(assignmentsToInsert, { onConflict: "submission_id, reviewer_agent_id" });
  }
}

export async function closePeerReviews(hackathonId: string) {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("status, judging_criteria")
    .eq("id", hackathonId)
    .single();

  if (!hackathon || hackathon.status !== "judging") return;

  const meta = (typeof hackathon.judging_criteria === "string" 
    ? JSON.parse(hackathon.judging_criteria) 
    : hackathon.judging_criteria) as Record<string, unknown>;

  if (meta.peer_judging_closed_at) return;

  const { data: judgments } = await supabaseAdmin
    .from("peer_judgments")
    .select("*, submissions!inner(hackathon_id)")
    .eq("submissions.hackathon_id", hackathonId);

  // Automatically skip remaining un-submitted assignments
  const pendingJudgments = judgments?.filter(j => j.status === "assigned") || [];
  for (const j of pendingJudgments) {
    await supabaseAdmin.from("peer_judgments").update({ status: "skipped" }).eq("id", j.id);
  }

  meta.peer_judging_closed_at = new Date().toISOString();
  await supabaseAdmin.from("hackathons").update({ judging_criteria: meta }).eq("id", hackathonId);

  await enqueueJob({
    type: "judging.aggregate_finalists",
    payload: { hackathon_id: hackathonId },
    maxAttempts: 3,
  });
}

export async function aggregateFinalists(hackathonId: string) {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("status, judging_criteria")
    .eq("id", hackathonId)
    .single();

  if (!hackathon || hackathon.status !== "judging") return;

  const { data: submissions } = await supabaseAdmin
    .from("submissions")
    .select("id, team_id, teams(name)")
    .eq("hackathon_id", hackathonId)
    .eq("status", "completed");

  if (!submissions || submissions.length === 0) return;

  const meta = (typeof hackathon.judging_criteria === "string" 
    ? JSON.parse(hackathon.judging_criteria) 
    : hackathon.judging_criteria) as Record<string, unknown>;

  const { data: peerJudgments } = await supabaseAdmin
    .from("peer_judgments")
    .select("*")
    .eq("status", "submitted"); // we only care about submitted scores

  const { data: runtimeChecks } = await supabaseAdmin
    .from("deployment_checks")
    .select("*");

  const { data: evaluations } = await supabaseAdmin
    .from("evaluations")
    .select("submission_id, total_score");

  const results = [];

  for (const sub of submissions) {
    const subEvals = evaluations?.filter(e => e.submission_id === sub.id) || [];
    const repo_score = subEvals.length > 0 ? subEvals[0].total_score : 0;

    const subRuntime = runtimeChecks?.filter(r => r.submission_id === sub.id) || [];
    const runtime_score = subRuntime.length > 0 && subRuntime[0].runtime_score !== null 
      ? subRuntime[0].runtime_score 
      : 0;

    const subPeers = peerJudgments?.filter(p => p.submission_id === sub.id) || [];
    const peerScores = subPeers.map(p => p.total_score).filter(s => s !== null) as number[];
    
    let peer_score = 0;
    const warnings: string[] = [];

    if (peerScores.length > 0) {
      peerScores.sort((a, b) => a - b);
      const mid = Math.floor(peerScores.length / 2);
      peer_score = peerScores.length % 2 !== 0 ? peerScores[mid] : (peerScores[mid - 1] + peerScores[mid]) / 2;
    }

    if (peerScores.length < 2) {
      warnings.push(`Low peer review count: ${peerScores.length}`);
    }

    // Renormalize if missing components
    let wPeer = meta.peer_weight !== undefined ? Number(meta.peer_weight) : 0.40;
    let wRepo = meta.repo_weight !== undefined ? Number(meta.repo_weight) : 0.30;
    let wRun = meta.runtime_weight !== undefined ? Number(meta.runtime_weight) : 0.30;

    // If peer reviews are < 2, maybe we fallback to 0 peer_score and renormalize? 
    // Task 3.9: Add renormalized score fallback and warnings when peer review count is below 2
    if (peerScores.length < 2) {
      // Ignore peer score, renormalize repo and runtime
      wPeer = 0;
      const totalRemaining = wRepo + wRun;
      if (totalRemaining > 0) {
        wRepo = wRepo / totalRemaining;
        wRun = wRun / totalRemaining;
      }
    }

    let finalist_score = (peer_score * wPeer) + (repo_score * wRepo) + (runtime_score * wRun);
    finalist_score = Math.round(finalist_score);

    // Save finalist_evidence to evaluation raw_response
    const { persistComponentScoresAndEvidence } = await import("./judging-persistence");
    await persistComponentScoresAndEvidence(sub.id, {
      peer_score,
      repo_score,
      runtime_score,
      finalist_score,
      warnings,
    });

    const team = sub.teams as { name?: string } | null;
    results.push({
      submission_id: sub.id,
      team_id: sub.team_id,
      team_name: team?.name || sub.team_id,
      finalist_score,
      peer_score,
      repo_score,
      runtime_score,
      review_count: peerScores.length,
      warnings
    });
  }

  results.sort((a, b) => b.finalist_score - a.finalist_score);

  // 5.2 Select top 3 finalists by default, top 5 for 20+ completed submissions, and up to top 5 when ranks 4-5 are within 5 points of rank 3
  let max_finalists = 3;
  if (submissions.length >= 20 || (meta.max_finalists && Number(meta.max_finalists) >= 5)) {
    max_finalists = 5;
  } else if (results.length > 3) {
    const scoreRank3 = results[2].finalist_score;
    if (results.length >= 4 && scoreRank3 - results[3].finalist_score <= 5) {
      max_finalists = 4;
      if (results.length >= 5 && scoreRank3 - results[4].finalist_score <= 5) {
        max_finalists = 5;
      }
    }
  }

  const contenders = results.slice(0, max_finalists).map(r => ({
    ...r,
    repo_summary: `Scores - Peer: ${r.peer_score}, Repo: ${r.repo_score}, Runtime: ${r.runtime_score}. Warnings: ${r.warnings.join(", ")}`,
    gemini_score: r.finalist_score,
  }));

  meta.genlayer_status = "queued";
  meta.genlayer_contenders = contenders;
  meta.genlayer_fallback_team_id = contenders.length > 0 ? contenders[0].team_id : null;
  meta.judge_method = "transparent_pipeline";

  await supabaseAdmin
    .from("hackathons")
    .update({ judging_criteria: meta })
    .eq("id", hackathonId);

  await updateActiveJudgingRunForHackathon(hackathonId, "waiting_genlayer");

  await enqueueJob({
    type: "genlayer.start",
    payload: { hackathon_id: hackathonId },
    maxAttempts: 3,
  });
}

export async function startGenLayer(hackathonId: string) {
  // Just defer to continueGenLayer which has a state machine
  await continueGenLayer(hackathonId);
}

export async function continueGenLayer(hackathonId: string) {
  const { continueGenLayerJudging } = await import("./judge");
  const done = await continueGenLayerJudging(hackathonId);
  if (!done) {
    await enqueueJob({
      type: "genlayer.continue",
      payload: { hackathon_id: hackathonId },
      runAt: new Date(Date.now() + 60_000),
      maxAttempts: 20,
    });
  } else {
    await enqueueJob({
      type: "genlayer.notify",
      payload: { hackathon_id: hackathonId },
      maxAttempts: 3,
    });
  }
}

export async function persistGenLayerResult(hackathonId: string) {
  // This is already handled by continueGenLayerJudging internally when reading_result state finishes.
  // But we have it here if we want to explicitly call it later.
}

export async function notifyGenLayerResult(hackathonId: string) {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("status, judging_criteria")
    .eq("id", hackathonId)
    .single();

  if (hackathon?.status === "completed") {
    console.log(`[JUDGING] Completed judging for hackathon ${hackathonId}`);
    // Optional: send Telegram notification
  }
}
