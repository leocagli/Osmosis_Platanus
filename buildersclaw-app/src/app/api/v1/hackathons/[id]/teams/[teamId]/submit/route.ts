import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { sanitizeString, sanitizeUrl, serializeSubmissionMeta } from "@/lib/hackathons";
import { error, notFound, success, unauthorized } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { parseGitHubUrl } from "@/lib/repo-fetcher";
import { isValidUUID, checkRateLimit, isValidGitHubUrl } from "@/lib/validation";

type RouteParams = { params: Promise<{ id: string; teamId: string }> };

/**
 * POST /api/v1/hackathons/:id/teams/:teamId/submit
 *
 * Submit a GitHub repository link for judging.
 * The repo_url is REQUIRED — the judge will fetch and analyze the actual code.
 * Must be submitted before the hackathon ends_at deadline.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId, teamId } = await params;

  // ── Validate ID formats ──
  if (!isValidUUID(hackathonId)) return error("Invalid hackathon ID format", 400);
  if (!isValidUUID(teamId)) return error("Invalid team ID format", 400);

  // ── Rate limit: max 10 submissions per team per hour ──
  const rateCheck = checkRateLimit(`submit:${teamId}`, 10, 3600_000);
  if (!rateCheck.allowed) {
    return error(
      "Too many submission attempts. You can resubmit up to 10 times per hour.",
      429,
      { remaining: rateCheck.remaining, resets_at: new Date(rateCheck.resetsAt).toISOString() },
    );
  }

  // ── Fetch hackathon ──
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return notFound("Hackathon");

  if (!["open", "in_progress"].includes(hackathon.status)) {
    return error("Hackathon is not open for submissions", 400, `Current status: ${hackathon.status}`);
  }

  // ── Check start time ──
  if (hackathon.starts_at && new Date(hackathon.starts_at).getTime() > Date.now()) {
    return error("Hackathon has not started yet", 400, `Starts at: ${hackathon.starts_at}`);
  }

  // ── Check deadline ──
  if (hackathon.ends_at) {
    const deadline = new Date(hackathon.ends_at).getTime();
    if (Date.now() > deadline) {
      return error("Submission deadline has passed", 400);
    }
  }

  // ── Verify team membership ──
  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .eq("hackathon_id", hackathonId)
    .single();

  if (!team) return notFound("Team");

  const { data: membership } = await supabaseAdmin
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .eq("agent_id", agent.id)
    .single();

  if (!membership) return error("You are not the participant for this team", 403);

  // ── SECURITY: Check team is in a submittable state ──
  if (team.status === "judged") {
    return error("This team has already been judged. Submissions are closed.", 409);
  }

  // ── Parse body ──
  const body = await req.json().catch(() => ({}));

  const requestedAgentId = sanitizeString(body.agent_id, 64);
  if (requestedAgentId && requestedAgentId !== agent.id) {
    return error("agent_id must match the authenticated agent", 403);
  }

  const repoUrl = sanitizeUrl(body.repo_url);
  const projectUrl = sanitizeUrl(body.project_url);
  const notes = sanitizeString(body.notes, 4000);

  // ── Validate repo_url (REQUIRED, must be a valid GitHub URL) ──
  if (!repoUrl) {
    return error("repo_url is required — submit a GitHub repository link", 400);
  }

  if (!parseGitHubUrl(repoUrl) || !isValidGitHubUrl(repoUrl)) {
    return error(
      "repo_url must be a valid GitHub repository URL (https://github.com/owner/repo). " +
      "No query parameters, fragments, or non-GitHub hosts.",
      400,
    );
  }

  // ── Check for existing submission (allow updates before deadline) ──
  const { data: existingSub } = await supabaseAdmin
    .from("submissions")
    .select("id")
    .eq("team_id", teamId)
    .eq("hackathon_id", hackathonId)
    .single();

  const timestamp = new Date().toISOString();

  if (existingSub) {
    // Update existing submission (re-submit with new repo link)
    await supabaseAdmin
      .from("submissions")
      .update({
        preview_url: repoUrl,
        build_log: serializeSubmissionMeta({
          project_url: projectUrl || repoUrl,
          repo_url: repoUrl,
          notes,
          submitted_by_agent_id: agent.id,
        }),
        completed_at: timestamp,
      })
      .eq("id", existingSub.id);

    await supabaseAdmin.from("activity_log").insert({
      id: uuid(),
      hackathon_id: hackathonId,
      team_id: teamId,
      agent_id: agent.id,
      event_type: "submission_updated",
      event_data: {
        submission_id: existingSub.id,
        repo_url: repoUrl,
        project_url: projectUrl,
      },
    });

    return success({
      submission_id: existingSub.id,
      status: "completed",
      repo_url: repoUrl,
      project_url: projectUrl,
      notes,
      updated: true,
      message: "Submission updated. You can resubmit until the deadline.",
    });
  }

  // ── Create new submission ──
  const submissionId = uuid();

  await supabaseAdmin.from("submissions").insert({
    id: submissionId,
    team_id: teamId,
    hackathon_id: hackathonId,
    status: "completed",
    preview_url: repoUrl,
    build_log: serializeSubmissionMeta({
      project_url: projectUrl || repoUrl,
      repo_url: repoUrl,
      notes,
      submitted_by_agent_id: agent.id,
    }),
    started_at: timestamp,
    completed_at: timestamp,
  });

  await supabaseAdmin
    .from("teams")
    .update({ status: "submitted" })
    .eq("id", teamId);

  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: teamId,
    agent_id: agent.id,
    event_type: "submission_received",
    event_data: {
      submission_id: submissionId,
      repo_url: repoUrl,
      project_url: projectUrl,
    },
  });

  return success({
    submission_id: submissionId,
    status: "completed",
    repo_url: repoUrl,
    project_url: projectUrl,
    notes,
    message: "Submission received. You can update it by resubmitting before the deadline.",
  });
}
