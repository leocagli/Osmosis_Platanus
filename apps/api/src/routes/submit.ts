import { randomUUID as uuid } from "crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { sanitizeString, sanitizeUrl, serializeSubmissionMeta } from "@buildersclaw/shared/hackathons";
import { parseGitHubUrl, verifyGitHubRepo } from "@buildersclaw/shared/repo-fetcher";
import { isValidUUID, checkRateLimit, isValidGitHubUrl } from "@buildersclaw/shared/validation";
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

    const db = getDb();
    const [hackathon] = await db
      .select({
        id: schema.hackathons.id,
        status: schema.hackathons.status,
        starts_at: schema.hackathons.startsAt,
        ends_at: schema.hackathons.endsAt,
        github_repo: schema.hackathons.githubRepo,
      })
      .from(schema.hackathons)
      .where(eq(schema.hackathons.id, hackathonId))
      .limit(1);
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

    const [team] = await db
      .select({ id: schema.teams.id, status: schema.teams.status })
      .from(schema.teams)
      .where(and(eq(schema.teams.id, teamId), eq(schema.teams.hackathonId, hackathonId)))
      .limit(1);
    if (!team) return notFound(reply, "Team");

    const [membership] = await db.select({ id: schema.teamMembers.id }).from(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agent.id))).limit(1);
    if (!membership) return fail(reply, "You are not the participant for this team", 403);

    if (team.status === "judged") {
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

    const siblingSubmissions = await db
      .select({ team_id: schema.submissions.teamId, preview_url: schema.submissions.previewUrl })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.hackathonId, hackathonId), ne(schema.submissions.teamId, teamId)));
    const duplicateRepo = siblingSubmissions.some((sub) => typeof sub.preview_url === "string" && normalizeRepoIdentity(sub.preview_url) === submittedRepo);
    if (duplicateRepo) return fail(reply, "repo_url is already being used by another team in this hackathon", 409, "Each team must submit its own unique GitHub repository URL.");

    const [existingSub] = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.teamId, teamId), eq(schema.submissions.hackathonId, hackathonId)))
      .limit(1);
    const timestamp = new Date().toISOString();

    if (existingSub) {
      await db.update(schema.submissions).set({
        previewUrl: repoUrl,
        buildLog: serializeSubmissionMeta({ project_url: projectUrl || repoUrl, repo_url: repoUrl, notes, submitted_by_agent_id: agent.id }),
        completedAt: timestamp,
      }).where(eq(schema.submissions.id, existingSub.id));

      await db.insert(schema.activityLog).values({ id: uuid(), hackathonId, teamId, agentId: agent.id, eventType: "submission_updated", eventData: { submission_id: existingSub.id, repo_url: repoUrl, project_url: projectUrl } });

      return ok(reply, { submission_id: existingSub.id, status: "completed", repo_url: repoUrl, project_url: projectUrl, notes, updated: true, message: "Submission updated. You can resubmit until the deadline." });
    }

    const submissionId = uuid();
    await db.insert(schema.submissions).values({
      id: submissionId, teamId, hackathonId, status: "completed",
      previewUrl: repoUrl,
      buildLog: serializeSubmissionMeta({ project_url: projectUrl || repoUrl, repo_url: repoUrl, notes, submitted_by_agent_id: agent.id }),
      startedAt: timestamp, completedAt: timestamp,
    });

    await db.update(schema.teams).set({ status: "submitted" }).where(eq(schema.teams.id, teamId));
    await db.insert(schema.activityLog).values({ id: uuid(), hackathonId, teamId, agentId: agent.id, eventType: "submission_received", eventData: { submission_id: submissionId, repo_url: repoUrl, project_url: projectUrl } });

    return ok(reply, { submission_id: submissionId, status: "completed", repo_url: repoUrl, project_url: projectUrl, notes, message: "Submission received. You can update it by resubmitting before the deadline." }, 201);
  });
}
