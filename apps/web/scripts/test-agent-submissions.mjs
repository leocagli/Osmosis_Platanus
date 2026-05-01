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
const TEST_REPOS = (process.env.TEST_AGENT_REPO_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const DEFAULT_PUBLIC_REPOS = [
  "https://github.com/vercel/ai-chatbot",
  "https://github.com/vercel/commerce",
];

if (!TEST_CREDIT_SECRET) {
  throw new Error("Missing TEST_CREDIT_SECRET or ADMIN_API_KEY");
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
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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

async function registerAgent(label) {
  const githubUsername = uid(`repo_${label}`).toLowerCase();
  const telegramUsername = uid(`tg_${label}`).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);

  const response = await api("POST", "/agents/register", {
    name: uid(`agent_${label}`),
    model: "gpt-4o",
    description: "Simple repo submission test agent",
    stack: "node.js",
    github_username: githubUsername,
    telegram_username: telegramUsername,
  });

  if (!response.ok) {
    throw new Error(`register ${label} failed: ${JSON.stringify(response.json)}`);
  }

  return {
    id: response.json.data.agent.id,
    name: response.json.data.agent.name,
    apiKey: response.json.data.agent.api_key,
    githubUsername,
  };
}

async function main() {
  const seeded = await api(
    "POST",
    "/seed-test",
    {
      title: `Agent Repo Submission Test ${Date.now()}`,
      brief: "Verify agents submit their own unique repository URLs.",
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
  const agents = [await registerAgent("alpha"), await registerAgent("beta")];
  const results = [];
  const repoUrls = TEST_REPOS.length >= agents.length ? TEST_REPOS : DEFAULT_PUBLIC_REPOS;

  if (repoUrls.length < agents.length) {
    throw new Error("Not enough repo URLs configured for test-agent-submissions");
  }

  for (const [index, agent] of agents.entries()) {
    const join = await api("POST", `/hackathons/${hackathonId}/join`, {}, agent.apiKey);
    if (!join.ok) {
      throw new Error(`join failed for ${agent.name}: ${JSON.stringify(join.json)}`);
    }

    const teamId = join.json.data.team.id;
    const repoUrl = repoUrls[index];
    const submit = await api(
      "POST",
      `/hackathons/${hackathonId}/teams/${teamId}/submit`,
      { repo_url: repoUrl, notes: `Submitted by ${agent.name}` },
      agent.apiKey,
    );

    if (!submit.ok) {
      throw new Error(`submit failed for ${agent.name}: ${JSON.stringify(submit.json)}`);
    }

    results.push({
      agent: agent.name,
      github_username: agent.githubUsername,
      team_id: teamId,
      repo_url: submit.json.data.repo_url,
    });
  }

  console.log("Agent repo submissions:\n");
  for (const result of results) {
    console.log(`- ${result.agent} (${result.github_username})`);
    console.log(`  team: ${result.team_id}`);
    console.log(`  repo: ${result.repo_url}`);
  }

  console.log("\nSUCCESS: each agent submitted a unique repo URL");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
