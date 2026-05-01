import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Mode = "success" | "fallback" | "all";
type JsonObject = Record<string, unknown>;

interface SeededHackathon {
  hackathonId: string;
  winnerTeamId: string;
  fallbackTeamId: string;
  winnerSubmissionId: string;
  agentIds: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const genlayerRoot = path.join(appRoot, "genlayer");

loadEnvFile(path.join(appRoot, ".env.local"));
loadEnvFile(path.join(appRoot, ".env"), { override: true });

const mode = parseMode(process.argv.slice(2));
const glsimPort = Number.parseInt(process.env.GLSIM_PORT || "4012", 10);
const glsimUrl = `http://127.0.0.1:${glsimPort}/api`;
const localPrivateKey =
  process.env.GENLAYER_LOCAL_PRIVATE_KEY
  || "0x1111111111111111111111111111111111111111111111111111111111111111";
const githubRepoBase = process.env.TEST_REPO_URL || "https://github.com/vercel/next.js";
const TEAM_ALPHA_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_BETA_ID = "22222222-2222-4222-8222-222222222222";
const TEAM_GAMMA_ID = "33333333-3333-4333-8333-333333333333";

const mockWinner = {
  winner_team_id: TEAM_ALPHA_ID,
  winner_team_name: "Alpha Team",
  final_score: 92,
  reasoning: "Alpha best satisfies the brief with the strongest functionality, polish, and technical completeness.",
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function parseMode(args: string[]): Mode {
  const match = args.find((arg) => arg.startsWith("--mode="));
  if (!match) return "all";
  const value = match.slice("--mode=".length);
  if (value === "success" || value === "fallback" || value === "all") return value;
  throw new Error(`Unsupported mode: ${value}`);
}

function loadEnvFile(filePath: string, options: { override?: boolean } = {}) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (options.override || !(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function step(label: string, message: string) {
  console.log(`\n${label} ${message}`);
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  OK  ${label}`);
    return;
  }
  failed += 1;
  const line = `  FAIL ${label}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  failures.push(line);
}

function parseMeta(raw: unknown): JsonObject {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as JsonObject : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw as JsonObject : {};
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(method: string, params: unknown = []) {
  const response = await fetch(glsimUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  }

  return json.result;
}

async function waitForGlsim(proc: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`GLSim exited early with code ${proc.exitCode}`);
    }

    try {
      await rpc("eth_chainId");
      return;
    } catch {
      await sleep(250);
    }
  }

  throw new Error("Timed out waiting for GLSim to start");
}

function createAdminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function insertAgent(admin: SupabaseClient, name: string) {
  const id = crypto.randomUUID();
  const apiKey = `buildersclaw_${crypto.randomBytes(16).toString("hex")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const now = new Date().toISOString();

  const { error } = await admin.from("agents").insert({
    id,
    name,
    display_name: name,
    description: `${name} orchestration test agent`,
    wallet_address: null,
    api_key_hash: apiKeyHash,
    model: "gpt-4o",
    personality: null,
    strategy: JSON.stringify({ stack: "node.js" }),
    status: "active",
    created_at: now,
    last_active: now,
  });

  if (error) {
    throw new Error(`Failed to insert agent ${name}: ${JSON.stringify(error)}`);
  }

  return { id, apiKey };
}

async function seedHackathonBase(admin: SupabaseClient, title: string, criteria: JsonObject) {
  const hackathonId = crypto.randomUUID();
  const now = new Date();

  const { error } = await admin.from("hackathons").insert({
    id: hackathonId,
    title,
    description: "GenLayer orchestration test hackathon",
    brief: "Pick the strongest production-ready developer tool from the top contenders.",
    rules: null,
    entry_type: "free",
    entry_fee: 0,
    prize_pool: 100,
    platform_fee_pct: 0.1,
    max_participants: 100,
    team_size_min: 1,
    team_size_max: 1,
    build_time_seconds: 300,
    challenge_type: "tool",
    status: "judging",
    created_by: null,
    starts_at: new Date(now.getTime() - 60_000).toISOString(),
    ends_at: new Date(now.getTime() - 1_000).toISOString(),
    judging_criteria: criteria,
  });

  if (error) {
    throw new Error(`Failed to insert hackathon ${title}: ${JSON.stringify(error)}`);
  }

  return hackathonId;
}

async function seedTeam(admin: SupabaseClient, hackathonId: string, teamId: string, teamName: string, floorNumber: number, leaderAgentId: string) {
  const { error: teamError } = await admin.from("teams").insert({
    id: teamId,
    hackathon_id: hackathonId,
    name: teamName,
    color: ["#00c2a8", "#ff8a00", "#5b8cff"][floorNumber - 1] || "#7a5cff",
    floor_number: floorNumber,
    status: "submitted",
    created_by: leaderAgentId,
  });

  if (teamError) {
    throw new Error(`Failed to insert team ${teamName}: ${JSON.stringify(teamError)}`);
  }

  const { error: memberError } = await admin.from("team_members").insert({
    id: crypto.randomUUID(),
    team_id: teamId,
    agent_id: leaderAgentId,
    role: "leader",
    revenue_share_pct: 100,
    joined_via: "direct",
    status: "active",
  });

  if (memberError) {
    throw new Error(`Failed to insert team member for ${teamName}: ${JSON.stringify(memberError)}`);
  }
}

async function seedSubmissionAndEvaluation(
  admin: SupabaseClient,
  hackathonId: string,
  teamId: string,
  repoUrl: string,
  score: number,
  feedback: string,
) {
  const submissionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const { error: subError } = await admin.from("submissions").insert({
    id: submissionId,
    team_id: teamId,
    hackathon_id: hackathonId,
    status: "completed",
    preview_url: repoUrl,
    build_log: JSON.stringify({ repo_url: repoUrl, project_url: repoUrl, notes: feedback }),
    started_at: timestamp,
    completed_at: timestamp,
  });

  if (subError) {
    throw new Error(`Failed to insert submission for ${teamId}: ${JSON.stringify(subError)}`);
  }

  const { error: evalError } = await admin.from("evaluations").upsert({
    submission_id: submissionId,
    functionality_score: score,
    brief_compliance_score: score,
    code_quality_score: score,
    architecture_score: score,
    innovation_score: score,
    completeness_score: score,
    documentation_score: score,
    testing_score: score,
    security_score: score,
    deploy_readiness_score: score,
    total_score: score,
    judge_feedback: feedback,
    raw_response: JSON.stringify({ total_score: score, judge_feedback: feedback }),
  }, { onConflict: "submission_id" });

  if (evalError) {
    throw new Error(`Failed to insert evaluation for ${teamId}: ${JSON.stringify(evalError)}`);
  }

  return submissionId;
}

async function seedQueuedHackathon(admin: SupabaseClient, scenario: string): Promise<SeededHackathon> {
  const alphaLeader = await insertAgent(admin, uid(`${scenario}_alpha`));
  const betaLeader = await insertAgent(admin, uid(`${scenario}_beta`));
  const gammaLeader = await insertAgent(admin, uid(`${scenario}_gamma`));

  const alphaId = TEAM_ALPHA_ID;
  const betaId = TEAM_BETA_ID;
  const gammaId = TEAM_GAMMA_ID;

  const contenders = [
    {
      team_id: alphaId,
      team_name: "Alpha Team",
      repo_summary: "Excellent architecture, polished UX, strong tests, and complete deployment guidance.",
      gemini_score: 91,
    },
    {
      team_id: betaId,
      team_name: "Beta Team",
      repo_summary: "Good implementation with useful functionality but weaker testing depth and product polish.",
      gemini_score: 84,
    },
    {
      team_id: gammaId,
      team_name: "Gamma Team",
      repo_summary: "Interesting concept with partial execution and several missing production details.",
      gemini_score: 73,
    },
  ];

  const criteria = {
    genlayer_status: "queued",
    genlayer_contenders: contenders,
    genlayer_fallback_team_id: alphaId,
    judge_method: "gemini_pending_genlayer",
    notes: "Gemini pre-scored submissions. Top contenders queued for GenLayer.",
  } satisfies JsonObject;

  const hackathonId = await seedHackathonBase(admin, uid(`${scenario}_hackathon`), criteria);

  await seedTeam(admin, hackathonId, alphaId, "Alpha Team", 1, alphaLeader.id);
  await seedTeam(admin, hackathonId, betaId, "Beta Team", 2, betaLeader.id);
  await seedTeam(admin, hackathonId, gammaId, "Gamma Team", 3, gammaLeader.id);

  const winnerSubmissionId = await seedSubmissionAndEvaluation(
    admin,
    hackathonId,
    alphaId,
    githubRepoBase,
    91,
    contenders[0].repo_summary,
  );
  await seedSubmissionAndEvaluation(admin, hackathonId, betaId, githubRepoBase, 84, contenders[1].repo_summary);
  await seedSubmissionAndEvaluation(admin, hackathonId, gammaId, githubRepoBase, 73, contenders[2].repo_summary);

  return {
    hackathonId,
    winnerTeamId: alphaId,
    fallbackTeamId: alphaId,
    winnerSubmissionId,
    agentIds: [alphaLeader.id, betaLeader.id, gammaLeader.id],
  };
}

async function seedFallbackHackathon(admin: SupabaseClient, scenario: string): Promise<SeededHackathon> {
  const seeded = await seedQueuedHackathon(admin, scenario);
  const criteria = {
    genlayer_status: "deploying",
    genlayer_contenders: [
      {
        team_id: seeded.winnerTeamId,
        team_name: "Alpha Team",
        repo_summary: "Alpha fallback candidate",
        gemini_score: 91,
      },
      {
        team_id: TEAM_BETA_ID,
        team_name: "Beta Team",
        repo_summary: "Beta challenger",
        gemini_score: 84,
      },
    ],
    genlayer_fallback_team_id: seeded.fallbackTeamId,
    genlayer_deploy_tx_hash: "0xdeadbeef",
    judge_method: "gemini_pending_genlayer",
  } satisfies JsonObject;

  const { error } = await admin
    .from("hackathons")
    .update({ judging_criteria: criteria, status: "judging" })
    .eq("id", seeded.hackathonId);

  if (error) {
    throw new Error(`Failed to update fallback hackathon metadata: ${JSON.stringify(error)}`);
  }

  return seeded;
}

async function fetchHackathon(admin: SupabaseClient, hackathonId: string) {
  const { data, error } = await admin
    .from("hackathons")
    .select("id, title, status, judging_criteria")
    .eq("id", hackathonId)
    .single();
  if (error || !data) {
    throw new Error(`Failed to fetch hackathon ${hackathonId}: ${JSON.stringify(error)}`);
  }
  return data;
}

async function fetchEvaluation(admin: SupabaseClient, submissionId: string) {
  const { data, error } = await admin
    .from("evaluations")
    .select("submission_id, total_score, judge_feedback, raw_response")
    .eq("submission_id", submissionId)
    .single();
  if (error || !data) {
    throw new Error(`Failed to fetch evaluation ${submissionId}: ${JSON.stringify(error)}`);
  }
  return data;
}

async function cleanupHackathon(admin: SupabaseClient, hackathonId: string) {
  const { data: teams } = await admin.from("teams").select("id").eq("hackathon_id", hackathonId);
  const teamIds = (teams || []).map((team) => team.id as string);

  const { data: submissions } = await admin.from("submissions").select("id").eq("hackathon_id", hackathonId);
  const submissionIds = (submissions || []).map((submission) => submission.id as string);

  for (const submissionId of submissionIds) {
    await admin.from("evaluations").delete().eq("submission_id", submissionId);
  }

  await admin.from("submissions").delete().eq("hackathon_id", hackathonId);

  for (const teamId of teamIds) {
    await admin.from("team_members").delete().eq("team_id", teamId);
  }

  await admin.from("teams").delete().eq("hackathon_id", hackathonId);
  await admin.from("activity_log").delete().eq("hackathon_id", hackathonId);
  await admin.from("marketplace_listings").delete().eq("hackathon_id", hackathonId);
  await admin.from("prompt_rounds").delete().eq("hackathon_id", hackathonId);
  await admin.from("hackathons").delete().eq("id", hackathonId);
}

async function cleanupAgents(admin: SupabaseClient, agentIds: string[]) {
  if (agentIds.length === 0) return;
  await admin.from("agents").delete().in("id", agentIds);
}

async function runSuccessScenario(admin: SupabaseClient, continueGenLayerJudging: (hackathonId: string) => Promise<boolean>) {
  step("1.", "Seeding queued GenLayer hackathon for success path");
  const seeded = await seedQueuedHackathon(admin, "gl_success");

  try {
    const observedStatuses: string[] = [];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await continueGenLayerJudging(seeded.hackathonId);
      const hackathon = await fetchHackathon(admin, seeded.hackathonId);
      const meta = parseMeta(hackathon.judging_criteria);
      const status = typeof meta.genlayer_status === "string" ? meta.genlayer_status : "<missing>";
      observedStatuses.push(status);
      if (hackathon.status === "completed") {
        break;
      }
      await sleep(300);
    }

    const hackathon = await fetchHackathon(admin, seeded.hackathonId);
    const meta = parseMeta(hackathon.judging_criteria);
    const evaluation = await fetchEvaluation(admin, seeded.winnerSubmissionId);
    const rawResponse = parseMeta(evaluation.raw_response);

    assert(hackathon.status === "completed", "success path completes hackathon", `statuses: ${observedStatuses.join(" -> ")}`);
    assert(meta.genlayer_status === "completed", "success path marks GenLayer completed");
    assert(typeof meta.genlayer_contract === "string" && meta.genlayer_contract.length > 0, "success path stores GenLayer contract address");
    assert(typeof meta.genlayer_reasoning === "string" && meta.genlayer_reasoning.length > 0, "success path stores GenLayer reasoning");
    assert(meta.winner_team_id === seeded.winnerTeamId, "success path stores winning team id", `got ${String(meta.winner_team_id)}`);
    assert(meta.judge_method === "gemini+genlayer", "success path updates judge_method to gemini+genlayer");

    const genlayerResult = parseMeta(meta.genlayer_result);
    assert(genlayerResult.finalized === true, "success path stores finalized GenLayer result");
    assert(genlayerResult.winner_team_id === seeded.winnerTeamId, "success path stores GenLayer winner result");
    assert(evaluation.total_score === mockWinner.final_score, "success path overwrites winner evaluation score", `got ${String(evaluation.total_score)}`);
    assert(typeof evaluation.judge_feedback === "string" && evaluation.judge_feedback.includes("GenLayer On-Chain Verdict"), "success path annotates winner evaluation feedback");
    assert(typeof rawResponse.genlayer_result === "object" && rawResponse.genlayer_result !== null, "success path stores genlayer_result in evaluation raw_response");
  } finally {
    await cleanupHackathon(admin, seeded.hackathonId);
    await cleanupAgents(admin, seeded.agentIds);
  }
}

async function runFallbackScenario(admin: SupabaseClient, continueGenLayerJudging: (hackathonId: string) => Promise<boolean>) {
  step("2.", "Seeding broken GenLayer state for fallback path");
  const seeded = await seedFallbackHackathon(admin, "gl_fallback");

  try {
    await continueGenLayerJudging(seeded.hackathonId);
    await sleep(100);

    const hackathon = await fetchHackathon(admin, seeded.hackathonId);
    const meta = parseMeta(hackathon.judging_criteria);

    assert(hackathon.status === "completed", "fallback path completes hackathon");
    assert(meta.genlayer_status === "failed", "fallback path marks GenLayer failed");
    assert(meta.winner_team_id === seeded.fallbackTeamId, "fallback path persists Gemini fallback winner", `got ${String(meta.winner_team_id)}`);
    assert(meta.judge_method === "gemini", "fallback path switches judge_method to gemini");
    assert(typeof meta.genlayer_last_error === "string" && meta.genlayer_last_error.length > 0, "fallback path records GenLayer error");
    assert(typeof meta.notes === "string" && meta.notes.includes("GenLayer fallback to Gemini winner after error"), "fallback path explains fallback in notes");
  } finally {
    await cleanupHackathon(admin, seeded.hackathonId);
    await cleanupAgents(admin, seeded.agentIds);
  }
}

async function main() {
  step("0.", `Starting GenLayer orchestration test (${mode})`);

  const env = { ...process.env };
  env.PYTHONPATH = env.PYTHONPATH
    ? `${genlayerRoot}${path.delimiter}${env.PYTHONPATH}`
    : genlayerRoot;

  const glsim = spawn("uv", ["run", "glsim", "--port", String(glsimPort), "--validators", "5"], {
    cwd: genlayerRoot,
    env,
    stdio: "ignore",
  });

  try {
    await waitForGlsim(glsim);
    await rpc("sim_installMocks", {
      llm_mocks: {
        ".*impartial judge.*": JSON.stringify(mockWinner),
      },
      strict: true,
    });

    process.env.GENLAYER_RPC_URL = glsimUrl;
    process.env.GENLAYER_CHAIN = "localnet";
    process.env.GENLAYER_PRIVATE_KEY = localPrivateKey;

    const admin = createAdminClient();
    const judgeModule = await import("../src/lib/judge");
    const continueGenLayerJudging = judgeModule.continueGenLayerJudging;

    if (mode === "success" || mode === "all") {
      await runSuccessScenario(admin, continueGenLayerJudging);
    }

    if (mode === "fallback" || mode === "all") {
      await runFallbackScenario(admin, continueGenLayerJudging);
    }
  } finally {
    glsim.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => glsim.once("exit", resolve)),
      sleep(5_000),
    ]);
    if (glsim.exitCode === null) {
      glsim.kill("SIGKILL");
    }
  }

  if (failed > 0) {
    throw new Error(`GenLayer orchestration test failed with ${failed} assertion(s):\n${failures.join("\n")}`);
  }

  console.log(`\nSUCCESS: GenLayer orchestration checks passed (${passed} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
