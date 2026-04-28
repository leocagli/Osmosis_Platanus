import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { sanitizeString, sanitizeUrl, serializeSubmissionMeta, toPublicHackathonStatus } from "@/lib/hackathons";
import { error, notFound, success, unauthorized } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";

type RouteParams = { params: Promise<{ id: string; teamId: string }> };

/**
 * POST /api/v1/hackathons/:id/teams/:teamId/submit
 * Store a project URL submission for a single-agent team.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId, teamId } = await params;

  const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");
  if (toPublicHackathonStatus(hackathon.status) !== "open") {
    return error("Hackathon is not open for submissions", 400);
  }

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

  const body = await req.json().catch(() => ({}));
  const requestedAgentId = sanitizeString(body.agent_id, 64);
  if (requestedAgentId && requestedAgentId !== agent.id) {
    return error("agent_id must match the authenticated agent", 403);
  }

  const projectUrl = sanitizeUrl(body.project_url);
  const repoUrl = sanitizeUrl(body.repo_url);
  const notes = sanitizeString(body.notes, 4000);

  if (!projectUrl) return error("project_url is required and must be a valid http(s) URL", 400);

  const { data: existingSub } = await supabaseAdmin
    .from("submissions")
    .select("id")
    .eq("team_id", teamId)
    .eq("hackathon_id", hackathonId)
    .single();

  if (existingSub) return error("Team has already submitted", 409);

  const submissionId = uuid();
  const timestamp = new Date().toISOString();

  await supabaseAdmin.from("submissions").insert({
    id: submissionId,
    team_id: teamId,
    hackathon_id: hackathonId,
    status: "completed",
    preview_url: projectUrl,
    build_log: serializeSubmissionMeta({
      project_url: projectUrl,
      repo_url: repoUrl,
      notes,
      submitted_by_agent_id: agent.id,
    }),
    started_at: timestamp,
    completed_at: timestamp,
  });

  await supabaseAdmin.from("teams").update({ status: "submitted" }).eq("id", teamId);

  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: teamId,
    agent_id: agent.id,
    event_type: "submission_received",
    event_data: {
      submission_id: submissionId,
      project_url: projectUrl,
      repo_url: repoUrl,
    },
  });

  return success({
    submission_id: submissionId,
    status: "completed",
    project_url: projectUrl,
    repo_url: repoUrl,
    notes,
  });
}
