#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

loadEnvFile(path.join(appRoot, ".env.local"));
loadEnvFile(path.join(appRoot, ".env"), { override: true });

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://localhost:3000");
const TEST_CREDIT_SECRET = process.env.TEST_CREDIT_SECRET || process.env.ADMIN_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!TEST_CREDIT_SECRET) {
  throw new Error("Missing TEST_CREDIT_SECRET or ADMIN_API_KEY");
}

if (!GITHUB_TOKEN) {
  throw new Error("Missing GITHUB_TOKEN");
}

function loadEnvFile(filePath, options = {}) {
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

function normalizeBaseUrl(value) {
  return value.replace("://localhost:", "://127.0.0.1:");
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function agentName(label) {
  return `agent_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function githubHeaders() {
  return {
    Authorization: GITHUB_TOKEN.startsWith("github_pat_") ? `Bearer ${GITHUB_TOKEN}` : `token ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "buildersclaw-agent-real-github-submissions",
  };
}

async function github(method, apiPath, body) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: githubHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: response.ok, status: response.status, json };
}

async function api(method, apiPath, body, apiKey, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${BASE_URL}/api/v1${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: response.ok, status: response.status, json };
}

async function getGithubOwner() {
  if (process.env.GITHUB_OWNER) {
    return process.env.GITHUB_OWNER;
  }
  const viewer = await github("GET", "/user");
  if (!viewer.ok || !viewer.json.login) {
    throw new Error(`Failed to resolve GitHub owner: ${JSON.stringify(viewer.json)}`);
  }
  return viewer.json.login;
}

async function createPublicRepo(owner, repoName) {
  const viewer = await github("GET", "/user");
  if (!viewer.ok || !viewer.json.login) {
    throw new Error(`Failed to load GitHub viewer: ${JSON.stringify(viewer.json)}`);
  }

  const createPath = owner === viewer.json.login ? "/user/repos" : `/orgs/${owner}/repos`;
  const createRes = await github("POST", createPath, {
    name: repoName,
    description: "BuildersClaw real agent submission test",
    private: false,
    auto_init: true,
    has_issues: false,
    has_wiki: false,
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create GitHub repo: ${JSON.stringify(createRes.json)}`);
  }

  return {
    repoUrl: createRes.json.html_url,
    repoFullName: createRes.json.full_name,
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commitFile(repoFullName, filePath, content, message) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const existing = await github("GET", `/repos/${repoFullName}/contents/${encodeURIComponent(filePath)}`);
    const sha = existing.ok ? existing.json.sha : undefined;

    const put = await github("PUT", `/repos/${repoFullName}/contents/${encodeURIComponent(filePath)}`, {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    });

    if (put.ok) {
      return;
    }

    if (put.status !== 404 || attempt === 6) {
      throw new Error(`Failed to commit ${filePath}: ${JSON.stringify(put.json)}`);
    }

    await sleep(attempt * 1000);
  }
}

async function registerAgent(label, githubUsername) {
  const telegramUsername = uid(`tg_${label}`).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
  const response = await api("POST", "/agents/register", {
    name: agentName(label),
    model: "gpt-4o",
    description: "Real GitHub repo submission test agent",
    stack: "node.js",
    github_username: githubUsername,
    telegram_username: telegramUsername,
  });

  if (!response.ok) {
    throw new Error(`register ${label} failed: ${JSON.stringify(response.json)}`);
  }

  return {
    name: response.json.data.agent.name,
    apiKey: response.json.data.agent.api_key,
    githubUsername,
  };
}

async function main() {
  const owner = await getGithubOwner();

  const seeded = await api(
    "POST",
    "/seed-test",
    {
      title: `Real Agent Repo Submission Test ${Date.now()}`,
      brief: "Verify agents can submit real public repositories created and committed by the bot.",
      team_size_max: 1,
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    undefined,
    { "x-seed-secret": TEST_CREDIT_SECRET },
  );

  if (!seeded.ok) {
    throw new Error(`seed-test failed: ${JSON.stringify(seeded.json)}`);
  }

  const hackathonId = seeded.json.data.id;
  const labels = ["alpha", "beta"];
  const results = [];

  for (const label of labels) {
    const repoName = uid(`buildersclaw-agent-submit-${label}`);
    const createdRepo = await createPublicRepo(owner, repoName);
    const repoUrl = createdRepo.repoUrl;
    const repoFullName = createdRepo.repoFullName;

    await commitFile(
      repoFullName,
      "README.md",
      `# ${repoName}\n\nCreated by the BuildersClaw real submission test.\n`,
      `Initialize ${repoName}`,
    );
    await commitFile(
      repoFullName,
      "src/index.ts",
      `export function main() {\n  return \"${label} submission\"\n}\n`,
      `Add source file for ${label}`,
    );

    const agent = await registerAgent(label, owner);
    const join = await api("POST", `/hackathons/${hackathonId}/join`, {}, agent.apiKey);
    if (!join.ok) {
      throw new Error(`join failed for ${agent.name}: ${JSON.stringify(join.json)}`);
    }

    const teamId = join.json.data.team.id;
    const submit = await api(
      "POST",
      `/hackathons/${hackathonId}/teams/${teamId}/submit`,
      { repo_url: repoUrl, notes: `Real repo created and committed for ${label}` },
      agent.apiKey,
    );

    if (!submit.ok) {
      throw new Error(`submit failed for ${agent.name}: ${JSON.stringify(submit.json)}`);
    }

    results.push({
      agent: agent.name,
      team_id: teamId,
      repo_url: repoUrl,
      repo_full_name: repoFullName,
    });
  }

  console.log("Real GitHub repo submissions:\n");
  for (const result of results) {
    console.log(`- ${result.agent}`);
    console.log(`  team: ${result.team_id}`);
    console.log(`  repo: ${result.repo_url}`);
  }

  console.log("\nSUCCESS: agents submitted real public repos created and committed by the bot");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
