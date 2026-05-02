import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const ADMIN_API_KEY = requireEnv("ADMIN_API_KEY");
const REPOS = [
  process.env.E2E_REPO_1 || "https://github.com/fastify/fastify",
  process.env.E2E_REPO_2 || "https://github.com/vercel/next.js",
];

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function unique(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

async function api(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function createHackathon() {
  const now = Date.now();
  const response = await api("POST", "/hackathons", {
    title: `E2E Judging ${now}`,
    description: "Created by apps/api/scripts/e2e-judging.ts",
    brief: "Judge these repositories as production software projects. Prioritize correctness, architecture, testing, documentation, and deploy readiness.",
    rules: "Public GitHub repository required.",
    entry_type: "off_chain",
    entry_fee: 0,
    prize_pool: 500,
    team_size_min: 1,
    team_size_max: 1,
    max_participants: 10,
    challenge_type: "software",
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 60 * 60_000).toISOString(),
    judging_criteria: "Correctness, code quality, tests, docs, security, deploy readiness.",
  }, ADMIN_API_KEY);

  return response.data.id as string;
}

async function registerAgent(label: string) {
  const name = unique(`e2e_${label}`);
  const response = await api("POST", "/agents/register", {
    name,
    display_name: `E2E ${label}`,
    model: "gemini-2.0-flash",
    description: "Judging E2E agent",
    github_username: "buildersclaw",
    telegram_username: unique(`tg_${label}`).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32),
  });

  return {
    id: response.data.agent.id as string,
    name,
    apiKey: response.data.agent.api_key as string,
  };
}

async function joinHackathon(hackathonId: string, agentKey: string, teamName: string) {
  const response = await api("POST", `/hackathons/${hackathonId}/join`, { name: teamName }, agentKey);
  return response.data.team.id as string;
}

async function submitRepo(hackathonId: string, teamId: string, agentKey: string, repoUrl: string) {
  const response = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: repoUrl,
    notes: "Submitted by the Fastify E2E judging script.",
  }, agentKey);
  return response.data.submission_id as string;
}

async function queueJudging(hackathonId: string) {
  return api("POST", `/admin/hackathons/${hackathonId}/judge`, undefined, ADMIN_API_KEY);
}

async function getState(hackathonId: string) {
  const db = getDb();
  const [hackathon] = await db.select().from(schema.hackathons).where(eq(schema.hackathons.id, hackathonId)).limit(1);
  const runs = await db.select().from(schema.judgingRuns).where(eq(schema.judgingRuns.hackathonId, hackathonId)).orderBy(desc(schema.judgingRuns.createdAt)).limit(3);
  const submissions = await db.select().from(schema.submissions).where(eq(schema.submissions.hackathonId, hackathonId));
  const evaluations = await db.select().from(schema.evaluations);
  const jobs = await db.select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt)).limit(20);
  const submissionIds = new Set(submissions.map((submission) => submission.id));

  return {
    hackathon,
    runs,
    submissions,
    evaluations: evaluations.filter((evaluation) => submissionIds.has(evaluation.submissionId)),
    jobs,
  };
}

async function pollUntilDone(hackathonId: string) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const state = await getState(hackathonId);
    const run = state.runs[0];
    const failedJobs = state.jobs.filter((job) => job.status === "failed");

    console.log({
      hackathon_status: state.hackathon?.status,
      judging_run_status: run?.status,
      submissions: state.submissions.length,
      evaluations: state.evaluations.length,
      latest_jobs: state.jobs.slice(0, 6).map((job) => ({ type: job.type, status: job.status, attempts: job.attempts })),
    });

    if (failedJobs.length > 0) {
      console.log("Failed jobs:", failedJobs.map((job) => ({ id: job.id, type: job.type, error: job.lastError })));
    }
    if (state.hackathon?.status === "completed" || run?.status === "completed") return;
    if (run?.status === "failed") throw new Error(`Judging run failed: ${run.lastError}`);

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error("Timed out waiting for judging to complete");
}

async function main() {
  console.log(`Using API: ${BASE_URL}`);
  console.log("Creating hackathon...");
  const hackathonId = await createHackathon();

  console.log("Registering agents...");
  const alpha = await registerAgent("alpha");
  const beta = await registerAgent("beta");

  console.log("Joining hackathon...");
  const alphaTeamId = await joinHackathon(hackathonId, alpha.apiKey, "Alpha Team");
  const betaTeamId = await joinHackathon(hackathonId, beta.apiKey, "Beta Team");

  console.log("Submitting repos...");
  await submitRepo(hackathonId, alphaTeamId, alpha.apiKey, REPOS[0]);
  await submitRepo(hackathonId, betaTeamId, beta.apiKey, REPOS[1]);

  console.log("Queueing judging...");
  console.dir(await queueJudging(hackathonId), { depth: null });

  console.log("Polling judging state...");
  await pollUntilDone(hackathonId);

  console.log("Final leaderboard:");
  console.dir(await api("GET", `/hackathons/${hackathonId}/judge`), { depth: null });
  console.log(`Hackathon: ${BASE_URL}/api/v1/hackathons/${hackathonId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
