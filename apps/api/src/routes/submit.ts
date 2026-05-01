import { randomUUID as uuid } from "crypto";
import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../../../web/src/lib/supabase";
import { sanitizeString, sanitizeUrl, serializeSubmissionMeta } from "../../../web/src/lib/hackathons";
import { parseGitHubUrl, verifyGitHubRepo } from "../../../web/src/lib/repo-fetcher";
import { isValidUUID, checkRateLimit, isValidGitHubUrl } from "../../../web/src/lib/validation";
import { ok, fail, notFound, unauthorized } from "../respond";
import { authFastify } from "../auth";

function normalizeRepoIdentity(url: string): string | null {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return null;
  return `${parsed.owner}/${parsed.repo}`.toLowerCase();
}

export async function submitRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/hackathons/:id/teams/:teamId/submit", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const { id: hackathonId, teamId } = req.params as { id: string; teamId: string };
    if (!isValidUUID(hackathonId)) return fail(reply, "Invalid hackathon ID format", 400);
    if (!isValidUUID(teamId)) return fail(reply, "Invalid team ID format", 400);

    const rateCheck = checkRateLimit(`submit:${teamId}`, 10, 3600_000);
    if (!rateCheck.allowed) {
      return fail(reply, "Too many submission attempts. You can resubmit up to 10 times per hour.", 429, {
        remaining: rateCheck.remaining,
        resets_at: new Date(rateCheck.resetsAt).toISOString(),
      });
    }

    const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();
    if (!hackathon) return notFound(reply, "Hackathon");

    if (!["open", "in_progress"].includes(hackathon.status)) {
      return fail(reply, "Hackathon is not open for submissions", 400, `Current status: ${hackathon.status}`);
    }
    if (hackathon.starts_at && new Date(hackathon.starts_at).getTime() > Date.now()) {
      return fail(reply, "Hackathon has not started yet", 400, `Starts at: ${hackathon.starts_at}`);
    }
    if (hackathon.ends_at && Date.now() > new Date(hackathon.ends_at).getTime()) {
      return fail(reply, "Submission deadline has passed", 400);
    }

    const { data: team } = await supabaseAdmin.from("teams").select("*").eq("id", teamId).eq("hackathon_id", hackathonId).single();
    if (!team) return notFound(reply, "Team");

    const { data: membership } = await supabaseAdmin.from("team_members").select("*").eq("team_id", teamId).eq("agent_id", agent.id).single();
    if (!membership) return fail(reply, "You are not the participant for this team", 403);

    if ((team as { status: string }).status === "judged") {
      return fail(reply, "This team has already been judged. Submissions are closed.", 409);
    }

    const body = req.body as Record<string, unknown> || {};
    const requestedAgentId = sanitizeString(body.agent_id as string, 64);
    if (requestedAgentId && requestedAgentId !== agent.id) {
      return fail(reply, "agent_id must match the authenticated agent", 403);
    }

    const repoUrl = sanitizeUrl(body.repo_url as string);
    const projectUrl = sanitizeUrl(body.project_url as string);
    const notes = sanitizeString(body.notes as string, 4000);

    if (!repoUrl) return fail(reply, "repo_url is required — submit a GitHub repository link", 400);
    if (!parseGitHubUrl(repoUrl) || !isValidGitHubUrl(repoUrl)) {
      return fail(reply, "repo_url must be a valid GitHub repository URL (https://github.com/owner/repo).", 400);
    }

    try {
      const repoCheck = await verifyGitHubRepo(repoUrl, process.env.GITHUB_TOKEN);
      if (!repoCheck.exists) return fail(reply, "repo_url must point to an existing GitHub repository", 400, "Create the repository on GitHub and make it public before submitting.");
      if (!repoCheck.isPublic) return fail(reply, "repo_url must point to a public GitHub repository", 400, "Private repositories cannot be judged.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub repo verification failed";
      return fail(reply, message, 502, "Try again in a moment or verify the repository on GitHub manually.");
    }

    const submittedRepo = normalizeRepoIdentity(repoUrl);
    const sharedHackathonRepo = typeof hackathon.github_repo === "string" ? normalizeRepoIdentity(hackathon.github_repo) : null;
    if (submittedRepo && sharedHackathonRepo && submittedRepo === sharedHackathonRepo) {
      return fail(reply, "repo_url must be your team's own repository, not the shared hackathon repo", 400, "Create a separate public GitHub repository for your team before submitting.");
    }

    const { data: siblingSubmissions } = await supabaseAdmin.from("submissions").select("team_id, preview_url").eq("hackathon_id", hackathonId).neq("team_id", teamId);
    const duplicateRepo = (siblingSubmissions || []).some((sub) => typeof sub.preview_url === "string" && normalizeRepoIdentity(sub.preview_url) === submittedRepo);
    if (duplicateRepo) return fail(reply, "repo_url is already being used by another team in this hackathon", 409, "Each team must submit its own unique GitHub repository URL.");

    const { data: existingSub } = await supabaseAdmin.from("submissions").select("id").eq("team_id", teamId).eq("hackathon_id", hackathonId).single();
    const timestamp = new Date().toISOString();

    if (existingSub) {
      await supabaseAdmin.from("submissions").update({
        preview_url: repoUrl,
        build_log: serializeSubmissionMeta({ project_url: projectUrl || repoUrl, repo_url: repoUrl, notes, submitted_by_agent_id: agent.id }),
        completed_at: timestamp,
      }).eq("id", existingSub.id);

      await supabaseAdmin.from("activity_log").insert({ id: uuid(), hackathon_id: hackathonId, team_id: teamId, agent_id: agent.id, event_type: "submission_updated", event_data: { submission_id: existingSub.id, repo_url: repoUrl, project_url: projectUrl } });

      return ok(reply, { submission_id: existingSub.id, status: "completed", repo_url: repoUrl, project_url: projectUrl, notes, updated: true, message: "Submission updated. You can resubmit until the deadline." });
    }

    const submissionId = uuid();
    await supabaseAdmin.from("submissions").insert({
      id: submissionId, team_id: teamId, hackathon_id: hackathonId, status: "completed",
      preview_url: repoUrl,
      build_log: serializeSubmissionMeta({ project_url: projectUrl || repoUrl, repo_url: repoUrl, notes, submitted_by_agent_id: agent.id }),
      started_at: timestamp, completed_at: timestamp,
    });

    await supabaseAdmin.from("teams").update({ status: "submitted" }).eq("id", teamId);
    await supabaseAdmin.from("activity_log").insert({ id: uuid(), hackathon_id: hackathonId, team_id: teamId, agent_id: agent.id, event_type: "submission_received", event_data: { submission_id: submissionId, repo_url: repoUrl, project_url: projectUrl } });

    return ok(reply, { submission_id: submissionId, status: "completed", repo_url: repoUrl, project_url: projectUrl, notes, message: "Submission received. You can update it by resubmitting before the deadline." }, 201);
  });
}
