#!/usr/bin/env node

/**
 * Full E2E — Real autonomous solo-team flow
 *
 * Flow:
 *  1. Verify organizer funds and required env
 *  2. Deploy + fund a real BNB testnet escrow
 *  3. Create + approve a real contract-backed hackathon proposal
 *  4. Register 3 solo agents with real wallets
 *  5. Fund each wallet with gas + USDC and complete on-chain join
 *  6. Autonomously generate 3 differentiated real public GitHub repos
 *  7. Submit all repos to the hackathon
 *  8. Trigger Gemini judging and continue queued GenLayer via cron
 *  9. Finalize the winning solo team on-chain
 * 10. Claim the on-chain prize from the winning wallet
 */

import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const contractsRoot = path.resolve(appRoot, "../buildersclaw-contracts");

loadEnvFileViaShell(path.join(contractsRoot, ".env"));
loadEnvFileViaShell(path.join(appRoot, ".env.local"), { override: true });
loadEnvFileViaShell(path.join(appRoot, ".env"), { override: true });

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://localhost:3000");
const RPC_URL = requiredEnv("RPC_URL");
const CHAIN_ID = Number.parseInt(requiredEnv("CHAIN_ID"), 10);
const FACTORY_ADDRESS = getAddress(requiredEnv("FACTORY_ADDRESS"));
const USDC_ADDRESS = getAddress(requiredEnv("USDC_ADDRESS"));
const ADMIN_API_KEY = requiredEnv("ADMIN_API_KEY");
const CRON_SECRET = requiredEnv("CRON_SECRET");
const ORGANIZER_PRIVATE_KEY = normalizePrivateKey(requiredEnv("ORGANIZER_PRIVATE_KEY"));
const GEMINI_API_KEY = requiredEnv("GEMINI_API_KEY");
const USDC_SYMBOL = process.env.USDC_SYMBOL || "USDC";
const USDC_DECIMALS = Number.parseInt(process.env.USDC_DECIMALS || "18", 10);
const ENTRY_FEE_UNITS = parseUnits(process.env.TEST_ENTRY_FEE_USDC || "5", USDC_DECIMALS);
const SPONSOR_FUNDING_UNITS = parseUnits(process.env.TEST_SPONSOR_FUNDING_USDC || "100", USDC_DECIMALS);
const GAS_FUND_BNB = process.env.TEST_PARTICIPANT_GAS_BNB || "0.01";
const MIN_ORGANIZER_GAS_BNB = process.env.TEST_MIN_ORGANIZER_GAS_BNB || "0.045";
const DURATION_HOURS = Number.parseInt(process.env.TEST_DURATION_HOURS || "24", 10);
const TEST_CREDIT_SECRET = process.env.TEST_CREDIT_SECRET || ADMIN_API_KEY;
const GITHUB_OWNER_OVERRIDE = process.env.GITHUB_OWNER || "";
const BUILD_MODEL = process.env.E2E_AUTONOMOUS_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

const QUALITY_PROFILES = [
  {
    label: "alpha",
    quality: "strong",
    instructions: [
      "Implement all four routes correctly.",
      "Include validation for malformed JSON and invalid task payloads.",
      "Include a concise README with setup and endpoint examples.",
      "Include at least one meaningful test using the built-in node:test module.",
      "Keep the code clean, complete, and production-ready for a minimal demo.",
    ],
  },
  {
    label: "beta",
    quality: "medium",
    instructions: [
      "Implement all four routes, but keep the architecture simpler and less polished.",
      "Validation can be partial or shallow.",
      "README can be brief.",
      "No tests are required.",
      "Make the project viable but clearly less complete than a strong submission.",
    ],
  },
  {
    label: "gamma",
    quality: "weak",
    instructions: [
      "Implement only part of the brief, or implement all routes but in a visibly incomplete way.",
      "It must still be a real repo with coherent code, not random garbage.",
      "README should be minimal.",
      "No tests.",
      "Leave obvious missing polish, TODOs, or limited validation so the judge can rank it lower.",
    ],
  },
];

const chain = defineChain({
  id: CHAIN_ID,
  name: process.env.CHAIN_NAME || "buildersclaw-testnet",
  nativeCurrency: {
    name: process.env.CHAIN_CURRENCY_NAME || "BNB",
    symbol: process.env.CHAIN_CURRENCY_SYMBOL || "BNB",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
});

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const organizerAccount = privateKeyToAccount(ORGANIZER_PRIVATE_KEY);
const organizerWalletClient = createWalletClient({ account: organizerAccount, chain, transport: http(RPC_URL) });
const organizerAddress = organizerAccount.address;

const factoryAbi = parseAbi([
  "function createHackathon(address _token, uint256 _entryFee, uint256 _deadline) returns (address)",
  "function hackathonCount() view returns (uint256)",
  "function hackathons(uint256) view returns (address)",
  "event HackathonCreated(address indexed escrow, address indexed token, uint256 entryFee, uint256 deadline)",
]);

const escrowAbi = parseAbi([
  "function join()",
  "function fund(uint256 amount)",
  "function claim()",
  "function prizePool() view returns (uint256)",
  "function entryFee() view returns (uint256)",
  "function hasJoined(address) view returns (bool)",
  "function getWinnerShare(address) view returns (uint256)",
  "function winnerCount() view returns (uint256)",
  "function totalPrizeAtFinalize() view returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

let passed = 0;
let failed = 0;
const failures = [];

function loadEnvFileViaShell(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return;

  const output = execFileSync(
    "zsh",
    [
      "-lc",
      `set -a; source ${JSON.stringify(filePath)}; set +a; env -0`,
    ],
    {
      cwd: appRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  for (const entry of output.split("\0")) {
    if (!entry) continue;
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    if (options.override || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  return value.replace("://localhost:", "://127.0.0.1:");
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function fakeTelegram(label) {
  return `${label}_${Date.now().toString().slice(-6)}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
}

function newWallet(label) {
  let privateKey;
  do {
    privateKey = `0x${crypto.randomBytes(32).toString("hex")}`;
  } while (/^0x0+$/.test(privateKey));
  const account = privateKeyToAccount(privateKey);
  return {
    label,
    privateKey,
    account,
    walletClient: createWalletClient({ account, chain, transport: http(RPC_URL) }),
  };
}

function runCommand(command, args, cwd) {
  const env = { ...process.env };
  if (command === "gh") {
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
  }
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function step(label, message) {
  console.log(`\n${label} ${message}`);
}

function assert(condition, label, detail) {
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

function assertEqual(actual, expected, label) {
  assert(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertBigInt(actual, expected, label) {
  assert(actual === expected, label, `expected ${expected.toString()}, got ${actual.toString()}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const viewer = runCommand("gh", ["api", "user", "--jq", ".login"], appRoot);
  return GITHUB_OWNER_OVERRIDE || viewer;
}

async function ensureGithubAuthReady() {
  return runCommand("gh", ["api", "user", "--jq", ".login"], appRoot);
}

function writeRepoFiles(repoDir, files) {
  for (const file of files) {
    const absolutePath = path.join(repoDir, file.path);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content, "utf8");
  }
}

function publishRepo(owner, repoName, description, files, commitMessage) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "buildersclaw-full-e2e-"));
  writeRepoFiles(repoDir, files);

  runCommand("git", ["init", "-b", "main"], repoDir);
  runCommand("git", ["config", "user.name", "BuildersClaw E2E Bot"], repoDir);
  runCommand("git", ["config", "user.email", "buildersclaw-e2e@example.com"], repoDir);
  runCommand("git", ["add", "."], repoDir);
  runCommand("git", ["commit", "-m", commitMessage], repoDir);
  const createArgs = (targetOwner) => [
    "repo", "create", `${targetOwner}/${repoName}`,
    "--public",
    "--description", description,
    "--source", repoDir,
    "--remote", "origin",
    "--push",
  ];

  let finalOwner = owner;
  try {
    runCommand("gh", createArgs(owner), appRoot);
  } catch (error) {
    const viewer = runCommand("gh", ["api", "user", "--jq", ".login"], appRoot);
    if (!owner || owner === viewer) {
      throw error;
    }
    console.log(`  GitHub owner fallback: ${owner} -> ${viewer}`);
    runCommand("gh", createArgs(viewer), appRoot);
    finalOwner = viewer;
  }

  const commitSha = runCommand("git", ["rev-parse", "HEAD"], repoDir);
  return {
    repoUrl: `https://github.com/${finalOwner}/${repoName}`,
    repoFullName: `${finalOwner}/${repoName}`,
    commitSha,
  };
}

async function registerAgent(prefix, walletAddress, githubUsername, telegramUsername) {
  const payload = {
    name: uid(prefix),
    model: "gpt-4o",
    description: `${prefix} autonomous full e2e agent`,
    stack: "node.js",
    wallet_address: walletAddress,
    github_username: githubUsername,
    telegram_username: telegramUsername,
  };

  const reg = await api("POST", "/agents/register", payload);
  if (!reg.ok) {
    if (reg.status !== 429) {
      throw new Error(`Register ${prefix} failed: ${JSON.stringify(reg.json)}`);
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(`Register ${prefix} hit rate limit and no Supabase fallback is configured`);
    }
    const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const id = crypto.randomUUID();
    const apiKey = `buildersclaw_${crypto.randomBytes(32).toString("hex")}`;
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const strategy = JSON.stringify({
      stack: payload.stack,
      github_username: githubUsername,
      telegram_username: telegramUsername,
    });
    const insert = await supabaseAdmin.from("agents").insert({
      id,
      name: payload.name,
      display_name: payload.name,
      description: payload.description,
      wallet_address: walletAddress,
      api_key_hash: apiKeyHash,
      model: payload.model,
      personality: null,
      strategy,
      status: "active",
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    });
    if (insert.error) throw new Error(`Register ${prefix} fallback insert failed: ${JSON.stringify(insert.error)}`);
    return { id, name: payload.name, key: apiKey, githubUsername };
  }

  return {
    id: reg.json.data.agent.id,
    name: reg.json.data.agent.name,
    key: reg.json.data.agent.api_key,
    githubUsername,
  };
}

async function sendNative(fromClient, to, amountWei) {
  const txHash = await fromClient.sendTransaction({ account: fromClient.account, to, value: amountWei, chain });
  return publicClient.waitForTransactionReceipt({ hash: txHash });
}

async function writeContractAndWait(client, request) {
  const txHash = await client.writeContract({ ...request, account: client.account, chain });
  return publicClient.waitForTransactionReceipt({ hash: txHash });
}

async function transferUsdc(to, amount) {
  return writeContractAndWait(organizerWalletClient, {
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}

async function getUsdcBalance(address) {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

async function deployEscrow(deadlineUnix) {
  const hackathonCountBefore = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "hackathonCount",
  });

  const receipt = await writeContractAndWait(organizerWalletClient, {
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "createHackathon",
    args: [USDC_ADDRESS, ENTRY_FEE_UNITS, BigInt(deadlineUnix)],
  });

  let escrowAddress = null;
  const createdLog = receipt.logs.find((log) => log.address && getAddress(log.address) === FACTORY_ADDRESS && log.topics?.[1]);
  if (createdLog?.topics?.[1]) {
    escrowAddress = getAddress(`0x${createdLog.topics[1].slice(26)}`);
  } else {
    const hackathonCountAfter = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "hackathonCount",
    });
    if (hackathonCountAfter <= hackathonCountBefore) {
      throw new Error("Factory transaction succeeded but hackathon count did not increase");
    }
    escrowAddress = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "hackathons",
      args: [hackathonCountAfter - 1n],
    });
  }

  if (!escrowAddress) throw new Error("Could not resolve escrow address after factory deployment");
  return { escrowAddress, txHash: receipt.transactionHash };
}

async function fundEscrow(escrowAddress, amount) {
  await writeContractAndWait(organizerWalletClient, {
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrowAddress, amount],
  });

  return writeContractAndWait(organizerWalletClient, {
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "fund",
    args: [amount],
  });
}

async function submitProposal({ escrowAddress, fundingTxHash, endsAt, brief, title }) {
  const proposal = await api("POST", "/proposals", {
    company: `Autonomous E2E Co ${Date.now()}`,
    email: `autonomous-e2e-${Date.now()}@example.com`,
    track: "api",
    problem: "Verify full real autonomous hackathon flow with BNB Sepolia prizes and GenLayer judging.",
    judge_agent: "platform",
    prize_amount: formatUnits(SPONSOR_FUNDING_UNITS, USDC_DECIMALS),
    judging_priorities: "Real submissions, meaningful ranking, on-chain settlement, GenLayer consensus.",
    tech_requirements: "Pure Node.js task tracker API with differentiated solution quality.",
    hackathon_title: title,
    hackathon_brief: brief,
    hackathon_rules: "Pure Node.js only, public GitHub repos, solo teams only, real on-chain join required.",
    hackathon_deadline: endsAt,
    hackathon_min_participants: 3,
    hackathon_team_size_max: 1,
    challenge_type: "api",
    contract_address: escrowAddress,
    chain_id: CHAIN_ID,
    funding_tx_hash: fundingTxHash,
    sponsor_wallet: organizerAddress,
  });
  if (!proposal.ok) {
    if (proposal.status !== 429) {
      throw new Error(`Proposal submission failed: ${JSON.stringify(proposal.json)}`);
    }

    console.log("  Proposal route rate-limited, falling back to direct admin hackathon creation");
    const directCreate = await api("POST", "/hackathons", {
      title,
      brief,
      rules: "Pure Node.js only, public GitHub repos, solo teams only, real on-chain join required.",
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      team_size_min: 1,
      team_size_max: 1,
      challenge_type: "api",
      prize_pool: Number(formatUnits(SPONSOR_FUNDING_UNITS, USDC_DECIMALS)),
      chain_id: CHAIN_ID,
      contract_address: escrowAddress,
      sponsor_address: organizerAddress,
      token_address: USDC_ADDRESS,
      token_symbol: USDC_SYMBOL,
      token_decimals: USDC_DECIMALS,
      judging_criteria: brief,
      judge_method: "gemini_pending_genlayer",
    }, ADMIN_API_KEY);
    if (!directCreate.ok) {
      throw new Error(`Direct hackathon creation fallback failed: ${JSON.stringify(directCreate.json)}`);
    }

    return {
      proposalId: null,
      hackathonId: directCreate.json.data.id,
      creationFlow: "direct_admin_fallback",
    };
  }

  const approval = await api("PATCH", "/proposals", {
    id: proposal.json.data.id,
    status: "approved",
    notes: "Automated full real autonomous BNB/GenLayer approval.",
  }, ADMIN_API_KEY);
  if (!approval.ok) throw new Error(`Proposal approval failed: ${JSON.stringify(approval.json)}`);

  return {
    proposalId: proposal.json.data.id,
    hackathonId: approval.json.data.hackathon_id,
    creationFlow: "proposal_approval",
  };
}

async function approveAndJoinEscrow(participant, escrowAddress) {
  await writeContractAndWait(participant.walletClient, {
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrowAddress, ENTRY_FEE_UNITS],
  });

  return writeContractAndWait(participant.walletClient, {
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "join",
    args: [],
  });
}

async function claimPrize(participant, escrowAddress) {
  return writeContractAndWait(participant.walletClient, {
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "claim",
    args: [],
  });
}

async function generateRepoSpec({ title, brief, quality, instructions, teamLabel }) {
  const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await genai.models.generateContent({
    model: BUILD_MODEL,
    contents: `Hackathon title: ${title}\n\nHackathon brief:\n${brief}\n\nTeam label: ${teamLabel}\nQuality target: ${quality}\nSpecific instructions:\n- ${instructions.join("\n- ")}`,
    config: {
      systemInstruction: [
        "You are an autonomous solo hackathon builder creating a small real GitHub repository.",
        "Return only JSON matching the schema.",
        "Use ASCII only.",
        "Generate a compact Node.js project with a small set of files.",
        "Do not use frameworks. Prefer built-in Node.js modules.",
        "Every repository must be coherent, readable, and plausibly judgeable.",
        "Do not mention that this was AI-generated.",
      ].join(" "),
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: Type.OBJECT,
        required: ["summary", "files"],
        properties: {
          summary: { type: Type.STRING },
          files: {
            type: Type.ARRAY,
            minItems: 3,
            maxItems: 8,
            items: {
              type: Type.OBJECT,
              required: ["path", "content"],
              properties: {
                path: { type: Type.STRING },
                content: { type: Type.STRING },
              },
            },
          },
        },
      },
      temperature: quality === "strong" ? 0.4 : 0.7,
      maxOutputTokens: 12000,
    },
  });

  const text = response.text || "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse generated repo spec for ${teamLabel}`);
  }

  if (!parsed || !Array.isArray(parsed.files)) {
    throw new Error(`Generated repo spec missing files for ${teamLabel}`);
  }

  const files = parsed.files.map((file) => ({
    path: String(file.path || "").trim(),
    content: String(file.content || ""),
  })).filter((file) => file.path && file.content);

  const paths = new Set(files.map((file) => file.path));
  if (!paths.has("README.md")) {
    throw new Error(`Generated repo for ${teamLabel} is missing README.md`);
  }
  if (!paths.has("package.json")) {
    throw new Error(`Generated repo for ${teamLabel} is missing package.json`);
  }

  return {
    summary: String(parsed.summary || ""),
    files,
  };
}

async function buildAndPushRepo({ owner, hackathonTitle, brief, profile }) {
  const repoName = uid(`buildersclaw-full-real-${profile.label}`).replace(/_/g, "-").toLowerCase();
  const spec = await generateRepoSpec({
    title: hackathonTitle,
    brief,
    quality: profile.quality,
    instructions: profile.instructions,
    teamLabel: profile.label,
  });

  const repo = publishRepo(
    owner,
    repoName,
    `BuildersClaw full autonomous ${profile.quality} submission`,
    spec.files,
    `Build ${profile.quality} autonomous submission for ${profile.label}`,
  );

  return {
    repoUrl: repo.repoUrl,
    repoFullName: repo.repoFullName,
    commitSha: repo.commitSha,
    summary: spec.summary,
    quality: profile.quality,
    files: spec.files.map((file) => file.path),
  };
}

async function triggerJudging(hackathonId) {
  const response = await api("POST", `/admin/hackathons/${hackathonId}/judge`, {}, ADMIN_API_KEY);
  if (!response.ok) {
    throw new Error(`Judging trigger failed: ${JSON.stringify(response.json)}`);
  }
  return response;
}

async function cronJudge() {
  return api("GET", "/cron/judge", undefined, undefined, {
    Authorization: `Bearer ${CRON_SECRET}`,
  });
}

async function getHackathon(hackathonId) {
  const response = await api("GET", `/hackathons/${hackathonId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch hackathon ${hackathonId}: ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function getLeaderboard(hackathonId) {
  const response = await api("GET", `/hackathons/${hackathonId}/judge`);
  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard ${hackathonId}: ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function waitForJudgingCompletion(hackathonId) {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const hackathon = await getHackathon(hackathonId);
    const winner = hackathon.winner || null;
    console.log(`  judging poll ${attempt}: internal_status=${hackathon.internal_status}, public_status=${hackathon.status}, winner_team_id=${winner?.team_id || "<none>"}`);

    if (hackathon.internal_status === "completed" && winner?.team_id) {
      return hackathon;
    }

    if (hackathon.internal_status === "judging") {
      const cron = await cronJudge();
      assert(cron.ok, `Cron judge call succeeds on poll ${attempt}`, JSON.stringify(cron.json));
    }

    await sleep(15_000);
  }

  throw new Error(`Timed out waiting for hackathon ${hackathonId} to complete judging`);
}

async function main() {
  console.log("============================================================");
  console.log(" BuildersClaw Full Real Autonomous E2E");
  console.log("============================================================");
  console.log(` Base URL:        ${BASE_URL}`);
  console.log(` Chain ID:        ${CHAIN_ID}`);
  console.log(` Factory:         ${FACTORY_ADDRESS}`);
  console.log(` Token:           ${USDC_ADDRESS} (${USDC_SYMBOL})`);
  console.log(` Organizer:       ${organizerAddress}`);
  console.log(` Build model:     ${BUILD_MODEL}`);
  console.log(` Time:            ${new Date().toISOString()}`);

  const githubOwner = await getGithubOwner();
  const hackathonTitle = `Autonomous Task Tracker ${Date.now()}`;
  const hackathonBrief = [
    "Build a Node.js HTTP server exposing four routes: GET /tasks, POST /tasks, PATCH /tasks/:id, DELETE /tasks/:id.",
    "Persist tasks in memory.",
    "Each task has {id, title, done}.",
    "Include input validation, a README.md with setup instructions, and at least one test if you choose to make the repo stronger.",
    "Use pure Node.js only, no frameworks. The app should run with node index.js on port 3000 and reject invalid JSON with 400.",
  ].join(" ");

  step("1.", "Verify organizer has enough gas and USDC");
  const participantCount = BigInt(QUALITY_PROFILES.length);
  const minimumUsdc = SPONSOR_FUNDING_UNITS + (ENTRY_FEE_UNITS * participantCount);
  const [organizerGas, organizerUsdc] = await Promise.all([
    publicClient.getBalance({ address: organizerAddress }),
    getUsdcBalance(organizerAddress),
  ]);
  assert(organizerGas > parseUnits(MIN_ORGANIZER_GAS_BNB, 18), "Organizer has enough BNB for gas", organizerGas.toString());
  assert(organizerUsdc >= minimumUsdc, `Organizer has at least ${formatUnits(minimumUsdc, USDC_DECIMALS)} ${USDC_SYMBOL}`, formatUnits(organizerUsdc, USDC_DECIMALS));
  if (failed > 0) throw new Error("Organizer funding precheck failed");

  step("2.", "Create fresh wallets and register 3 solo agents");
  const participants = [];
  for (const profile of QUALITY_PROFILES) {
    const wallet = newWallet(profile.label);
    const telegram = fakeTelegram(profile.label);
    const agent = await registerAgent(`full_real_${profile.label}`, wallet.account.address, githubOwner, telegram);
    participants.push({ profile, wallet, agent });
  }
  assertEqual(participants.length, 3, "Registered 3 autonomous agents");

  step("3.", "Deploy fresh escrow via factory and fund it with sponsor USDC");
  const deadlineUnix = Math.floor(Date.now() / 1000) + DURATION_HOURS * 60 * 60;
  const endsAt = new Date(deadlineUnix * 1000).toISOString();
  const deploy = await deployEscrow(deadlineUnix);
  const fundReceipt = await fundEscrow(deploy.escrowAddress, SPONSOR_FUNDING_UNITS);
  const fundedPrizePool = await publicClient.readContract({
    address: deploy.escrowAddress,
    abi: escrowAbi,
    functionName: "prizePool",
  });
  assertBigInt(fundedPrizePool, SPONSOR_FUNDING_UNITS, "Escrow prize pool equals sponsor funding before joins");

  step("4.", "Create contract-backed hackathon from funded proposal");
  const proposal = await submitProposal({
    escrowAddress: deploy.escrowAddress,
    fundingTxHash: fundReceipt.transactionHash,
    endsAt,
    brief: hackathonBrief,
    title: hackathonTitle,
  });
  assert(typeof proposal.hackathonId === "string", "Proposal approval created a hackathon");

  step("5.", "Fund participant wallets and complete on-chain joins");
  const teams = [];
  for (const participant of participants) {
    await sendNative(organizerWalletClient, participant.wallet.account.address, parseUnits(GAS_FUND_BNB, 18));
    await transferUsdc(participant.wallet.account.address, ENTRY_FEE_UNITS);
    const usdcBalance = await getUsdcBalance(participant.wallet.account.address);
    assertBigInt(usdcBalance, ENTRY_FEE_UNITS, `${participant.profile.label} received exact USDC entry fee`);

    const joinReceipt = await approveAndJoinEscrow(participant.wallet, deploy.escrowAddress);
    const backendJoin = await api("POST", `/hackathons/${proposal.hackathonId}/join`, {
      tx_hash: joinReceipt.transactionHash,
      wallet_address: participant.wallet.account.address,
    }, participant.agent.key);
    assert(backendJoin.ok, `${participant.profile.label} backend join succeeds`, JSON.stringify(backendJoin.json));
    const teamId = backendJoin.json.data.team.id;
    const joinedFlag = await publicClient.readContract({
      address: deploy.escrowAddress,
      abi: escrowAbi,
      functionName: "hasJoined",
      args: [participant.wallet.account.address],
    });
    assert(joinedFlag === true, `${participant.profile.label} marked joined on-chain`);
    teams.push({ ...participant, teamId });
  }

  const prizeAfterJoins = await publicClient.readContract({
    address: deploy.escrowAddress,
    abi: escrowAbi,
    functionName: "prizePool",
  });
  assertBigInt(prizeAfterJoins, SPONSOR_FUNDING_UNITS + (ENTRY_FEE_UNITS * participantCount), "Escrow prize pool includes sponsor funding + all entry fees");

  step("6.", "Autonomously generate and push 3 real public repos");
  const githubViewer = await ensureGithubAuthReady();
  assert(!!githubViewer, "GitHub API authentication is ready", githubViewer || undefined);
  const builtRepos = await Promise.all(teams.map(async (team) => {
    const built = await buildAndPushRepo({
      owner: githubOwner,
      hackathonTitle,
      brief: hackathonBrief,
      profile: team.profile,
    });
    console.log(`  ${team.profile.label}: ${built.repoUrl}`);
    console.log(`    quality=${built.quality}, files=${built.files.join(", ")}`);
    return { ...team, ...built };
  }));
  assertEqual(builtRepos.length, 3, "Built and pushed 3 real repos");

  step("7.", "Submit all repos to the hackathon");
  for (const repo of builtRepos) {
    const submit = await api("POST", `/hackathons/${proposal.hackathonId}/teams/${repo.teamId}/submit`, {
      repo_url: repo.repoUrl,
      notes: `Autonomous ${repo.quality} submission. ${repo.summary}`,
    }, repo.agent.key);
    assert(submit.ok, `${repo.profile.label} repo submission succeeds`, JSON.stringify(submit.json));
  }

  step("8.", "Trigger Gemini judging and continue queued GenLayer via cron");
  const judge = await triggerJudging(proposal.hackathonId);
  assert(judge.status === 202 || judge.status === 200, "Judge trigger returns success", JSON.stringify(judge.json));
  assert(judge.status === 202, "GenLayer judging queued for top contenders", `expected 202, got ${judge.status}`);

  const completedHackathon = await waitForJudgingCompletion(proposal.hackathonId);
  const winnerTeamId = completedHackathon.winner?.team_id || null;
  assert(!!winnerTeamId, "Hackathon winner resolved after judging");
  const leaderboard = await getLeaderboard(proposal.hackathonId);
  assert(!!leaderboard, "Leaderboard endpoint returns after judging");

  step("9.", "Finalize the winning solo team on-chain");
  const winnerRepo = builtRepos.find((repo) => repo.teamId === winnerTeamId);
  if (!winnerRepo) {
    throw new Error(`Could not map winning team ${winnerTeamId} to a submitted repo`);
  }
  const finalize = await api("POST", `/admin/hackathons/${proposal.hackathonId}/finalize`, {
    winner_team_id: winnerTeamId,
    notes: "Automated full real autonomous E2E finalization.",
  }, ADMIN_API_KEY);
  assert(finalize.ok, "Admin finalize succeeds", JSON.stringify(finalize.json));
  assertEqual(finalize.json.data.winners.length, 1, "Finalize returns one winner entry for solo-team flow");
  const soleWinner = finalize.json.data.winners[0];
  assertEqual(soleWinner.share_bps, 10000, "Solo team winner receives 100% share");
  assertEqual(soleWinner.wallet.toLowerCase(), winnerRepo.wallet.account.address.toLowerCase(), "Finalize winner wallet matches winning solo team");

  step("10.", "Winner claims on-chain prize and escrow reaches zero");
  const totalPrizeAtFinalize = await publicClient.readContract({
    address: deploy.escrowAddress,
    abi: escrowAbi,
    functionName: "totalPrizeAtFinalize",
  });
  const winnerBefore = await getUsdcBalance(winnerRepo.wallet.account.address);
  await claimPrize(winnerRepo.wallet, deploy.escrowAddress);
  const [winnerAfter, finalPrizePool] = await Promise.all([
    getUsdcBalance(winnerRepo.wallet.account.address),
    publicClient.readContract({ address: deploy.escrowAddress, abi: escrowAbi, functionName: "prizePool" }),
  ]);
  assertBigInt(winnerAfter - winnerBefore, totalPrizeAtFinalize, "Winning solo wallet receives exact total prize");
  assertBigInt(finalPrizePool, 0n, "Escrow prize pool reaches zero after winner claim");

  console.log("\n------------------------------------------------------------");
  console.log(` Hackathon ID:     ${proposal.hackathonId}`);
  console.log(` Proposal ID:      ${proposal.proposalId}`);
  console.log(` Escrow:           ${deploy.escrowAddress}`);
  console.log(` Winner team:      ${winnerTeamId}`);
  console.log(` Winner repo:      ${winnerRepo.repoUrl}`);
  console.log(` Winner wallet:    ${winnerRepo.wallet.account.address}`);
  console.log(` Total prize:      ${formatUnits(totalPrizeAtFinalize, USDC_DECIMALS)} ${USDC_SYMBOL}`);
  console.log(` Deploy tx:        ${deploy.txHash}`);
  console.log(` Fund tx:          ${fundReceipt.transactionHash}`);
  console.log(` Finalize tx:      ${finalize.json.data.finalize_tx_hash}`);
  console.log("------------------------------------------------------------");
  console.log(` Passed: ${passed}`);
  console.log(` Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(" Failures:");
    for (const failure of failures) console.log(failure);
  }
  console.log("============================================================");

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
