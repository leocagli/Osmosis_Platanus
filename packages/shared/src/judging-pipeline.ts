import { sql, type SQL } from "drizzle-orm";
import { enqueueJob } from "./queue";
import { updateActiveJudgingRunForHackathon } from "./judging-runs";
import { isViableSubmission } from "./validation";
import { getDb } from "./db";
import { parseSubmissionMeta } from "./hackathons";
import type { Hackathon, Submission, JudgingRunMetadata } from "./types";

type HackathonJudgingRow = {
  id?: string;
  status: string;
  judging_criteria: JudgingRunMetadata | string | null;
};

type SubmissionWithTeamRow = Submission & {
  teams?: { name?: string; status?: string } | null;
};

type TeamMembersRow = {
  id: string;
  team_members: Array<{ agent_id: string; status: string }>;
};

type PeerJudgmentRow = {
  id: string;
  submission_id: string;
  status: string;
  total_score: number | null;
};

type DeploymentCheckRow = {
  submission_id: string;
  runtime_score: number | null;
};

type EvaluationScoreRow = {
  submission_id: string;
  total_score: number;
};

async function queryRows<T>(query: SQL) {
  return getDb().execute(query) as unknown as Promise<T[]>;
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function parseMetadata(value: JudgingRunMetadata | string | null | undefined): JudgingRunMetadata {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as JudgingRunMetadata;
  } catch {
    return {};
  }
}

async function upsertEvaluation(values: {
  submission_id: string;
  functionality_score?: number;
  brief_compliance_score?: number;
  code_quality_score?: number;
  architecture_score?: number;
  innovation_score?: number;
  completeness_score?: number;
  documentation_score?: number;
  testing_score?: number;
  security_score?: number;
  deploy_readiness_score?: number;
  total_score: number;
  judge_feedback: string;
  raw_response: string;
}) {
  await getDb().execute(sql`
    insert into evaluations (
      submission_id,
      functionality_score,
      brief_compliance_score,
      code_quality_score,
      architecture_score,
      innovation_score,
      completeness_score,
      documentation_score,
      testing_score,
      security_score,
      deploy_readiness_score,
      total_score,
      judge_feedback,
      raw_response
    ) values (
      ${values.submission_id},
      ${values.functionality_score ?? 0},
      ${values.brief_compliance_score ?? 0},
      ${values.code_quality_score ?? 0},
      ${values.architecture_score ?? 0},
      ${values.innovation_score ?? 0},
      ${values.completeness_score ?? 0},
      ${values.documentation_score ?? 0},
      ${values.testing_score ?? 0},
      ${values.security_score ?? 0},
      ${values.deploy_readiness_score ?? 0},
      ${values.total_score},
      ${values.judge_feedback},
      ${values.raw_response}
    )
    on conflict (submission_id) do update set
      functionality_score = excluded.functionality_score,
      brief_compliance_score = excluded.brief_compliance_score,
      code_quality_score = excluded.code_quality_score,
      architecture_score = excluded.architecture_score,
      innovation_score = excluded.innovation_score,
      completeness_score = excluded.completeness_score,
      documentation_score = excluded.documentation_score,
      testing_score = excluded.testing_score,
      security_score = excluded.security_score,
      deploy_readiness_score = excluded.deploy_readiness_score,
      total_score = excluded.total_score,
      judge_feedback = excluded.judge_feedback,
      raw_response = excluded.raw_response
  `);
}

export async function freezeSubmissions(hackathonId: string, judgingRunId: string) {
  await updateActiveJudgingRunForHackathon(hackathonId, "running");

  const [hackathon] = await queryRows<HackathonJudgingRow>(sql`
    select status, judging_criteria
    from hackathons
    where id = ${hackathonId}
    limit 1
  `);

  if (!hackathon) throw new Error("Hackathon not found");
  if (hackathon.status === "completed") {
    await updateActiveJudgingRunForHackathon(hackathonId, "completed");
    return;
  }

  // Atomically claim "judging" status
  const [locked] = await queryRows<{ id: string }>(sql`
    update hackathons
    set status = 'judging', updated_at = now()
    where id = ${hackathonId}
      and status in ('open', 'in_progress', 'judging')
    returning id
  `);

  if (!locked) return; // another worker got it

  let meta = parseMetadata(hackathon.judging_criteria);

  // Freeze submissions (just read them)
  const allSubmissions = await queryRows<SubmissionWithTeamRow>(sql`
    select submissions.*, json_build_object('name', teams.name, 'status', teams.status) as teams
    from submissions
    left join teams on teams.id = submissions.team_id
    where submissions.hackathon_id = ${hackathonId}
  `);

  if (allSubmissions.length === 0) {
    meta.notes = "Ended with 0 submissions.";
    meta.finalized_at = new Date().toISOString();
    await getDb().execute(sql`
      update hackathons
      set status = 'completed', judging_criteria = ${jsonb(meta)}, updated_at = now()
      where id = ${hackathonId}
    `);
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
      await upsertEvaluation({
        submission_id: sub.id,
        total_score: 0,
        judge_feedback: `Submission skipped: ${check.reason}.`,
        raw_response: JSON.stringify({ skipped: true, reason: check.reason }),
      });
    }
  }

  if (viableSubmissions.length === 0) {
    meta.notes = `Ended with ${allSubmissions.length} submissions but none had viable repos.`;
    meta.finalized_at = new Date().toISOString();
    meta.skipped_submissions = skippedSubmissions;
    await getDb().execute(sql`
      update hackathons
      set status = 'completed', judging_criteria = ${jsonb(meta)}, updated_at = now()
      where id = ${hackathonId}
    `);
    await updateActiveJudgingRunForHackathon(hackathonId, "completed", { metadata: { submissions_judged: 0, skipped_submissions: skippedSubmissions } });
    return;
  }

  meta.skipped_submissions = skippedSubmissions;
  meta.submissions_judged = viableSubmissions.length;
  await getDb().execute(sql`
    update hackathons
    set judging_criteria = ${jsonb(meta)}, updated_at = now()
    where id = ${hackathonId}
  `);

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
  const peerWindowHours = meta.peer_weight === 0 ? 0 : (meta.peer_review_window_hours ?? 2);
  await enqueueJob({
    type: "judging.close_peer_reviews",
    payload: { hackathon_id: hackathonId },
    runAt: new Date(Date.now() + peerWindowHours * 60 * 60 * 1000),
    maxAttempts: 3,
  });
}

export async function repoScore(hackathonId: string, submissionId: string) {
  const [hackathon] = await queryRows<Hackathon>(sql`
    select *
    from hackathons
    where id = ${hackathonId}
    limit 1
  `);

  const [submission] = await queryRows<Submission>(sql`
    select *
    from submissions
    where id = ${submissionId}
    limit 1
  `);

  if (!hackathon || !submission) return;

  try {
    const { judgeSubmission } = await import("./judge");
    const result = await judgeSubmission(submission as Submission, hackathon as Hackathon);

    await upsertEvaluation({
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

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`repoScore failed for ${submissionId}:`, msg);
    await upsertEvaluation({
      submission_id: submission.id,
      total_score: 0,
      judge_feedback: `Evaluation failed: ${msg}`,
      raw_response: JSON.stringify({ error: msg }),
    });
  }
}

export async function runtimeScore(hackathonId: string, submissionId: string) {
  void hackathonId;
  const [submission] = await queryRows<Pick<Submission, "preview_url" | "build_log">>(sql`
    select preview_url, build_log
    from submissions
    where id = ${submissionId}
    limit 1
  `);

  if (!submission) return;

  const meta = parseSubmissionMeta(submission.build_log, submission.preview_url);
  const urlStr = meta.project_url || submission.preview_url || meta.repo_url;
  
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
      const rawEvidence = {
          http_status: result.http_status,
          redirects: result.redirects,
          page_title: result.page_title,
      };
      await getDb().execute(sql`
        insert into deployment_checks (
          submission_id,
          url_checked,
          status,
          runtime_score,
          summary,
          raw_evidence,
          warnings
        ) values (
          ${submissionId},
          ${urlStr},
          ${result.status},
          ${runtime_score},
          ${result.text_summary || null},
          ${jsonb(rawEvidence)},
          ${warningsRecord ? jsonb(warningsRecord) : null}
        )
        on conflict (submission_id) do update set
          url_checked = excluded.url_checked,
          status = excluded.status,
          runtime_score = excluded.runtime_score,
          summary = excluded.summary,
          raw_evidence = excluded.raw_evidence,
          warnings = excluded.warnings,
          checked_at = now()
      `);
    }
  }
}

export async function assignPeerReviews(hackathonId: string) {
  const submissions = await queryRows<Pick<Submission, "id" | "team_id">>(sql`
    select id, team_id
    from submissions
    where hackathon_id = ${hackathonId}
      and status = 'completed'
  `);

  if (submissions.length === 0) return;

  const teams = await queryRows<TeamMembersRow>(sql`
    select
      teams.id,
      coalesce(
        json_agg(json_build_object('agent_id', team_members.agent_id, 'status', team_members.status))
          filter (where team_members.id is not null),
        '[]'::json
      ) as team_members
    from teams
    left join team_members on team_members.team_id = teams.id
    where teams.hackathon_id = ${hackathonId}
    group by teams.id
  `);

  if (teams.length === 0) return;

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
    for (const assignment of assignmentsToInsert) {
      await getDb().execute(sql`
        insert into peer_judgments (submission_id, reviewer_agent_id, status)
        values (${assignment.submission_id}, ${assignment.reviewer_agent_id}, ${assignment.status})
        on conflict (submission_id, reviewer_agent_id) do update set
          status = excluded.status
      `);
    }
  }
}

export async function closePeerReviews(hackathonId: string) {
  const [hackathon] = await queryRows<HackathonJudgingRow>(sql`
    select status, judging_criteria
    from hackathons
    where id = ${hackathonId}
    limit 1
  `);

  if (!hackathon || hackathon.status !== "judging") return;

  const meta = parseMetadata(hackathon.judging_criteria);

  if (meta.peer_judging_closed_at) return;

  const judgments = await queryRows<PeerJudgmentRow>(sql`
    select peer_judgments.*
    from peer_judgments
    inner join submissions on submissions.id = peer_judgments.submission_id
    where submissions.hackathon_id = ${hackathonId}
  `);

  // Automatically skip remaining un-submitted assignments
  const pendingJudgments = judgments.filter(j => j.status === "assigned");
  for (const j of pendingJudgments) {
    await getDb().execute(sql`update peer_judgments set status = 'skipped' where id = ${j.id}`);
  }

  meta.peer_judging_closed_at = new Date().toISOString();
  await getDb().execute(sql`
    update hackathons
    set judging_criteria = ${jsonb(meta)}, updated_at = now()
    where id = ${hackathonId}
  `);

  await enqueueJob({
    type: "judging.aggregate_finalists",
    payload: { hackathon_id: hackathonId },
    maxAttempts: 3,
  });
}

export async function aggregateFinalists(hackathonId: string) {
  const [hackathon] = await queryRows<HackathonJudgingRow>(sql`
    select status, judging_criteria
    from hackathons
    where id = ${hackathonId}
    limit 1
  `);

  if (!hackathon || hackathon.status !== "judging") return;

  const submissions = await queryRows<SubmissionWithTeamRow>(sql`
    select submissions.id, submissions.team_id, json_build_object('name', teams.name) as teams
    from submissions
    left join teams on teams.id = submissions.team_id
    where submissions.hackathon_id = ${hackathonId}
      and submissions.status = 'completed'
  `);

  if (submissions.length === 0) return;

  const meta = parseMetadata(hackathon.judging_criteria);

  const peerJudgments = await queryRows<PeerJudgmentRow>(sql`
    select *
    from peer_judgments
    where status = 'submitted'
  `); // we only care about submitted scores

  const runtimeChecks = await queryRows<DeploymentCheckRow>(sql`select * from deployment_checks`);

  const evaluations = await queryRows<EvaluationScoreRow>(sql`select submission_id, total_score from evaluations`);

  const results = [];

  for (const sub of submissions) {
    const subEvals = evaluations.filter(e => e.submission_id === sub.id);
    const repo_score = subEvals.length > 0 ? subEvals[0].total_score : 0;

    const subRuntime = runtimeChecks.filter(r => r.submission_id === sub.id);
    const runtime_score = subRuntime.length > 0 && subRuntime[0].runtime_score !== null 
      ? subRuntime[0].runtime_score 
      : 0;

    const subPeers = peerJudgments.filter(p => p.submission_id === sub.id);
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
  (meta as Record<string, unknown>).genlayer_fallback_team_id = contenders.length > 0 ? contenders[0].team_id : null;
  meta.judge_method = "transparent_pipeline";

  if (process.env.JUDGING_REQUIRE_GENLAYER !== "true") {
    const winner = contenders[0];
    if (!winner) throw new Error("No finalist available for judging fallback");

    meta.genlayer_status = "skipped";
    meta.winner_team_id = winner.team_id;
    meta.finalized_at = new Date().toISOString();
    meta.notes = "Completed by transparent pipeline fallback. Set JUDGING_REQUIRE_GENLAYER=true to require GenLayer consensus.";
    meta.scores = results;

    const [leader] = await queryRows<{ agent_id: string }>(sql`
      select agent_id
      from team_members
      where team_id = ${winner.team_id}
        and status = 'active'
      order by case when role = 'leader' then 0 else 1 end, joined_at asc
      limit 1
    `);
    if (leader?.agent_id) meta.winner_agent_id = leader.agent_id;

    await getDb().execute(sql`
      update hackathons
      set status = 'completed', judging_criteria = ${jsonb(meta)}, updated_at = now()
      where id = ${hackathonId}
    `);

    await updateActiveJudgingRunForHackathon(hackathonId, "completed", {
      metadata: { submissions_judged: submissions.length, genlayer_status: "skipped" },
    });
    return;
  }

  await getDb().execute(sql`
    update hackathons
    set judging_criteria = ${jsonb(meta)}, updated_at = now()
    where id = ${hackathonId}
  `);

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
  const [hackathon] = await queryRows<HackathonJudgingRow>(sql`
    select status, judging_criteria
    from hackathons
    where id = ${hackathonId}
    limit 1
  `);

  if (hackathon?.status === "completed") {
    console.log(`[JUDGING] Completed judging for hackathon ${hackathonId}`);
    // Optional: send Telegram notification
  }
}
