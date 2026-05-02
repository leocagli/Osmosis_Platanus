import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq, ne } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { sanitizeString, sanitizeUrl, serializeSubmissionMeta } from "@buildersclaw/shared/hackathons";
import { error, notFound, success, unauthorized } from "@buildersclaw/shared/responses";
import { parseGitHubUrl, verifyGitHubRepo } from "@buildersclaw/shared/repo-fetcher";
import { isValidUUID, checkRateLimit, isValidGitHubUrl } from "@buildersclaw/shared/validation";

type RouteParams = { params: Promise<{ id: string; teamId: string }> };

function normalizeRepoIdentity(url: string): string | null {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return null;
  return `${parsed.owner}/${parsed.repo}`.toLowerCase();
}

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

  const db = getDb();

  // ── Fetch hackathon ──
  const [hackathon] = await db
    .select()
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  if (!hackathon) return notFound("Hackathon");

  if (!["open", "in_progress"].includes(hackathon.status)) {
    return error("Hackathon is not open for submissions", 400, `Current status: ${hackathon.status}`);
  }

  // ── Check start time ──
  if (hackathon.startsAt && new Date(hackathon.startsAt).getTime() > Date.now()) {
    return error("Hackathon has not started yet", 400, `Starts at: ${hackathon.startsAt}`);
  }

  // ── Check deadline ──
  if (hackathon.endsAt) {
    const deadline = new Date(hackathon.endsAt).getTime();
    if (Date.now() > deadline) {
      return error("Submission deadline has passed", 400);
    }
  }

  // ── Verify team membership ──
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.hackathonId, hackathonId)))
    .limit(1);

  if (!team) return notFound("Team");

  const [membership] = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agent.id)))
    .limit(1);

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

  try {
    const repoCheck = await verifyGitHubRepo(repoUrl, process.env.GITHUB_TOKEN);
    if (!repoCheck.exists) {
      return error(
        "repo_url must point to an existing GitHub repository",
        400,
        "Create the repository on GitHub and make it public before submitting.",
      );
    }
    if (!repoCheck.isPublic) {
      return error(
        "repo_url must point to a public GitHub repository",
        400,
        "Private repositories cannot be judged. Make the repo public before submitting.",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub repo verification failed";
    return error(message, 502, "Try again in a moment or verify the repository on GitHub manually.");
  }

  const submittedRepo = normalizeRepoIdentity(repoUrl);
  const sharedHackathonRepo = typeof hackathon.githubRepo === "string"
    ? normalizeRepoIdentity(hackathon.githubRepo)
    : null;

  if (submittedRepo && sharedHackathonRepo && submittedRepo === sharedHackathonRepo) {
    return error(
      "repo_url must be your team's own repository, not the shared hackathon repo",
      400,
      "Create a separate public GitHub repository for your team before submitting.",
    );
  }

  const siblingSubmissions = await db
    .select({ teamId: schema.submissions.teamId, previewUrl: schema.submissions.previewUrl })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.hackathonId, hackathonId), ne(schema.submissions.teamId, teamId)));

  const duplicateRepo = siblingSubmissions.some((submission) => {
    if (typeof submission.previewUrl !== "string") return false;
    return normalizeRepoIdentity(submission.previewUrl) === submittedRepo;
  });

  if (duplicateRepo) {
    return error(
      "repo_url is already being used by another team in this hackathon",
      409,
      "Each team must submit its own unique GitHub repository URL.",
    );
  }

  // ── Check for existing submission (allow updates before deadline) ──
  const [existingSub] = await db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.teamId, teamId), eq(schema.submissions.hackathonId, hackathonId)))
    .limit(1);

  const timestamp = new Date().toISOString();

  if (existingSub) {
    // Update existing submission (re-submit with new repo link)
    await db.transaction(async (tx) => {
      await tx
        .update(schema.submissions)
        .set({
          previewUrl: repoUrl,
          buildLog: serializeSubmissionMeta({
            project_url: projectUrl || repoUrl,
            repo_url: repoUrl,
            notes,
            submitted_by_agent_id: agent.id,
          }),
          completedAt: timestamp,
        })
        .where(eq(schema.submissions.id, existingSub.id));

      await tx.insert(schema.activityLog).values({
        id: uuid(),
        hackathonId,
        teamId,
        agentId: agent.id,
        eventType: "submission_updated",
        eventData: {
          submission_id: existingSub.id,
          repo_url: repoUrl,
          project_url: projectUrl,
        },
      });
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

  await db.transaction(async (tx) => {
    await tx.insert(schema.submissions).values({
      id: submissionId,
      teamId,
      hackathonId,
      status: "completed",
      previewUrl: repoUrl,
      buildLog: serializeSubmissionMeta({
        project_url: projectUrl || repoUrl,
        repo_url: repoUrl,
        notes,
        submitted_by_agent_id: agent.id,
      }),
      startedAt: timestamp,
      completedAt: timestamp,
    });

    await tx
      .update(schema.teams)
      .set({ status: "submitted" })
      .where(eq(schema.teams.id, teamId));

    await tx.insert(schema.activityLog).values({
      id: uuid(),
      hackathonId,
      teamId,
      agentId: agent.id,
      eventType: "submission_received",
      eventData: {
        submission_id: submissionId,
        repo_url: repoUrl,
        project_url: projectUrl,
      },
    });
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
