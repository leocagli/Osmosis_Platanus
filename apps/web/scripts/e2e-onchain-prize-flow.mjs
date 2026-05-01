#!/usr/bin/env node

/**
 * E2E Test — BNB Sepolia USDC contract-backed marketplace flow
 *
 * Flow:
 *  1. Register leader + hired member with wallet/github/telegram prereqs
 *  2. Deploy a fresh escrow via the factory on-chain
 *  3. Fund the escrow with sponsor USDC
 *  4. Submit + approve an enterprise proposal using the funded escrow
 *  5. Leader receives gas + USDC, joins on-chain, then notifies backend
 *  6. Leader posts a marketplace listing and hired member claims it
 *  7. Team submits a repo
 *  8. Admin finalizes the hackathon on-chain
 *  9. Leader and hired member claim their USDC prizes independently
 * 10. Prize pool reaches zero
 *
 * Optional ERC-8004 validation:
 *   Set TEST_ERC8004_AGENT_ID + TEST_ERC8004_OWNER_PRIVATE_KEY to link the
 *   leader identity before posting the marketplace listing and assert that the
 *   marketplace API surfaces the linked identity.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
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

loadEnvFile(path.join(contractsRoot, ".env"));
loadEnvFile(path.join(appRoot, ".env.local"), { override: true });
loadEnvFile(path.join(appRoot, ".env"), { override: true });

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://localhost:3000");
const RPC_URL = requiredEnv("RPC_URL");
const CHAIN_ID = Number.parseInt(requiredEnv("CHAIN_ID"), 10);
const FACTORY_ADDRESS = getAddress(requiredEnv("FACTORY_ADDRESS"));
const USDC_ADDRESS = getAddress(requiredEnv("USDC_ADDRESS"));
const USDC_SYMBOL = process.env.USDC_SYMBOL || "USDC";
const USDC_DECIMALS = Number.parseInt(process.env.USDC_DECIMALS || "18", 10);
const ADMIN_API_KEY = requiredEnv("ADMIN_API_KEY");
const ORGANIZER_PRIVATE_KEY = normalizePrivateKey(requiredEnv("ORGANIZER_PRIVATE_KEY"));
const ENTRY_FEE_UNITS = parseUnits(process.env.TEST_ENTRY_FEE_USDC || "5", USDC_DECIMALS);
const SPONSOR_FUNDING_UNITS = parseUnits(process.env.TEST_SPONSOR_FUNDING_USDC || "50", USDC_DECIMALS);
const GAS_FUND_BNB = process.env.TEST_PARTICIPANT_GAS_BNB || "0.01";
const DURATION_HOURS = Number.parseInt(process.env.TEST_DURATION_HOURS || "24", 10);
const REPO_URL = process.env.TEST_REPO_URL || `https://github.com/${process.env.GITHUB_OWNER || "buildersclaw"}/onchain-marketplace-e2e-${Date.now()}`;
const OPTIONAL_ERC8004_AGENT_ID = process.env.TEST_ERC8004_AGENT_ID || "";
const OPTIONAL_ERC8004_OWNER_PRIVATE_KEY = process.env.TEST_ERC8004_OWNER_PRIVATE_KEY || "";
const OPTIONAL_ERC8004_SOURCE = process.env.TEST_ERC8004_SOURCE || "external";

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
  "function token() view returns (address)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

let passed = 0;
let failed = 0;
const failures = [];

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

async function api(method, apiPath, body, apiKey, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${BASE_URL}/api/v1${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { success: false, raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

async function registerAgent(prefix, walletAddress, githubUsername, telegramUsername) {
  const payload = {
    name: uid(prefix),
    model: "gpt-4o",
    description: `${prefix} on-chain marketplace e2e agent`,
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
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
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
    });
    if (insert.error) throw new Error(`Register ${prefix} fallback insert failed: ${JSON.stringify(insert.error)}`);
    return { id, name: payload.name, key: apiKey };
  }

  return {
    id: reg.json.data.agent.id,
    name: reg.json.data.agent.name,
    key: reg.json.data.agent.api_key,
  };
}

async function maybeLinkErc8004(agentKey) {
  if (!OPTIONAL_ERC8004_AGENT_ID || !OPTIONAL_ERC8004_OWNER_PRIVATE_KEY) {
    return { attempted: false };
  }

  const issuedAt = new Date().toISOString();
  const identityInfo = await api(
    "GET",
    `/agents/identity?identity_agent_id=${encodeURIComponent(OPTIONAL_ERC8004_AGENT_ID)}&issued_at=${encodeURIComponent(issuedAt)}`,
    null,
    agentKey,
  );
  if (!identityInfo.ok || !identityInfo.json?.data?.link_message) {
    return { attempted: true, linked: false, reason: `identity GET failed: ${JSON.stringify(identityInfo.json)}` };
  }

  const owner = privateKeyToAccount(normalizePrivateKey(OPTIONAL_ERC8004_OWNER_PRIVATE_KEY));
  const signature = await owner.signMessage({ message: identityInfo.json.data.link_message });
  const link = await api("POST", "/agents/identity", {
    action: "link",
    identity_agent_id: OPTIONAL_ERC8004_AGENT_ID,
    issued_at: issuedAt,
    signature,
    identity_source: OPTIONAL_ERC8004_SOURCE,
  }, agentKey);
  if (!link.ok) {
    return { attempted: true, linked: false, reason: `identity link failed: ${JSON.stringify(link.json)}` };
  }
  const sync = await api("POST", "/agents/identity", { action: "sync" }, agentKey);
  return {
    attempted: true,
    linked: sync.ok,
    reason: sync.ok ? null : `identity sync failed: ${JSON.stringify(sync.json)}`,
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

async function submitProposal({ escrowAddress, fundingTxHash, endsAt }) {
  const proposal = await api("POST", "/proposals", {
    company: `On-chain E2E Co ${Date.now()}`,
    email: `onchain-e2e-${Date.now()}@example.com`,
    track: "api",
    problem: "Verify BNB Sepolia USDC contract-backed marketplace flow.",
    judge_agent: "platform",
    prize_amount: formatUnits(SPONSOR_FUNDING_UNITS, USDC_DECIMALS),
    judging_priorities: "On-chain verification, finalization reliability, marketplace collaboration.",
    tech_requirements: "USDC-backed contract flow on BNB Sepolia with marketplace hiring.",
    hackathon_title: `BNB Sepolia Onchain Flow ${Date.now()}`,
    hackathon_brief: "Leader joins on-chain, hires via marketplace, then winners claim split USDC prizes.",
    hackathon_rules: "Leader must join on-chain with USDC approval and tx proof before backend registration.",
    hackathon_deadline: endsAt,
    hackathon_min_participants: 2,
    hackathon_team_size_max: 4,
    challenge_type: "api",
    contract_address: escrowAddress,
    chain_id: CHAIN_ID,
    funding_tx_hash: fundingTxHash,
    sponsor_wallet: organizerAddress,
  });
  if (!proposal.ok) throw new Error(`Proposal submission failed: ${JSON.stringify(proposal.json)}`);

  const approval = await api("PATCH", "/proposals", {
    id: proposal.json.data.id,
    status: "approved",
    notes: "Automated BNB Sepolia USDC E2E approval.",
  }, ADMIN_API_KEY);
  if (!approval.ok) throw new Error(`Proposal approval failed: ${JSON.stringify(approval.json)}`);

  return {
    proposalId: proposal.json.data.id,
    hackathonId: approval.json.data.hackathon_id,
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

async function main() {
  console.log("============================================================");
  console.log(" BuildersClaw BNB Sepolia USDC On-chain E2E");
  console.log("============================================================");
  console.log(` Base URL:        ${BASE_URL}`);
  console.log(` Chain ID:        ${CHAIN_ID}`);
  console.log(` Factory:         ${FACTORY_ADDRESS}`);
  console.log(` Token:           ${USDC_ADDRESS} (${USDC_SYMBOL})`);
  console.log(` Organizer:       ${organizerAddress}`);
  console.log(` Time:            ${new Date().toISOString()}`);

  step("1.", "Verify organizer has enough gas and USDC");
  const [organizerGas, organizerUsdc] = await Promise.all([
    publicClient.getBalance({ address: organizerAddress }),
    getUsdcBalance(organizerAddress),
  ]);
  const minimumUsdc = SPONSOR_FUNDING_UNITS + ENTRY_FEE_UNITS;
  assert(organizerGas > parseUnits(GAS_FUND_BNB, 18) * 3n, "Organizer has enough BNB for gas", organizerGas.toString());
  assert(organizerUsdc >= minimumUsdc, `Organizer has at least ${formatUnits(minimumUsdc, USDC_DECIMALS)} ${USDC_SYMBOL}`, formatUnits(organizerUsdc, USDC_DECIMALS));
  if (failed > 0) throw new Error("Organizer funding precheck failed");

  step("2.", "Create fresh leader and hired wallets + register agents");
  const leaderWallet = newWallet("leader");
  const hiredWallet = newWallet("hired");
  const leaderTelegram = fakeTelegram("leader");
  const hiredTelegram = fakeTelegram("hired");
  const leader = await registerAgent("onchain_leader", leaderWallet.account.address, uid("ghleader"), leaderTelegram);
  const hired = await registerAgent("onchain_hired", hiredWallet.account.address, uid("ghhired"), hiredTelegram);
  assert(!!leader.key && !!hired.key, "Leader and hired agents registered");

  step("3.", "Fund leader/hired with BNB gas and leader with USDC entry fee");
  await sendNative(organizerWalletClient, leaderWallet.account.address, parseUnits(GAS_FUND_BNB, 18));
  await sendNative(organizerWalletClient, hiredWallet.account.address, parseUnits(GAS_FUND_BNB, 18));
  await transferUsdc(leaderWallet.account.address, ENTRY_FEE_UNITS);
  const leaderUsdc = await getUsdcBalance(leaderWallet.account.address);
  assertBigInt(leaderUsdc, ENTRY_FEE_UNITS, "Leader received exact USDC entry fee");

  step("4.", "Deploy fresh escrow via factory and fund it with sponsor USDC");
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

  step("5.", "Create hackathon from funded proposal and verify backend contract state");
  const proposal = await submitProposal({
    escrowAddress: deploy.escrowAddress,
    fundingTxHash: fundReceipt.transactionHash,
    endsAt,
  });
  assert(typeof proposal.hackathonId === "string", "Proposal approval created a hackathon");
  const contractStateBeforeJoin = await api("GET", `/hackathons/${proposal.hackathonId}/contract`);
  assert(contractStateBeforeJoin.ok, "Contract endpoint loads before join", JSON.stringify(contractStateBeforeJoin.json));
  assertEqual(contractStateBeforeJoin.json.data.contract_address, deploy.escrowAddress, "Contract endpoint uses deployed escrow");
  assertEqual(contractStateBeforeJoin.json.data.status.entry_fee_units, ENTRY_FEE_UNITS.toString(), "Contract endpoint entry fee matches env");
  assertEqual(contractStateBeforeJoin.json.data.status.prize_pool_units, SPONSOR_FUNDING_UNITS.toString(), "Contract endpoint prize pool matches sponsor funding");

  step("6.", "Optional ERC-8004 link/sync for leader before marketplace listing");
  const identity = await maybeLinkErc8004(leader.key);
  if (!identity.attempted) {
    console.log("  SKIP ERC-8004 optional test (set TEST_ERC8004_AGENT_ID + TEST_ERC8004_OWNER_PRIVATE_KEY to enable)");
  } else {
    assert(identity.linked, "Leader ERC-8004 link/sync succeeds", identity.reason || undefined);
  }

  step("7.", "Leader approves USDC, joins on-chain, and notifies backend");
  const joinReceipt = await approveAndJoinEscrow(leaderWallet, deploy.escrowAddress);
  const joinBackend = await api("POST", `/hackathons/${proposal.hackathonId}/join`, {
    tx_hash: joinReceipt.transactionHash,
    wallet_address: leaderWallet.account.address,
  }, leader.key);
  assert(joinBackend.ok, "Leader backend join succeeds", JSON.stringify(joinBackend.json));
  const teamId = joinBackend.json.data.team.id;
  const joinedFlag = await publicClient.readContract({
    address: deploy.escrowAddress,
    abi: escrowAbi,
    functionName: "hasJoined",
    args: [leaderWallet.account.address],
  });
  assert(joinedFlag === true, "Escrow marks leader as joined on-chain");
  const prizeAfterJoin = await publicClient.readContract({
    address: deploy.escrowAddress,
    abi: escrowAbi,
    functionName: "prizePool",
  });
  assertBigInt(prizeAfterJoin, SPONSOR_FUNDING_UNITS + ENTRY_FEE_UNITS, "Escrow prize pool includes sponsor funding + leader entry fee");

  step("8.", "Leader posts marketplace listing and hired member claims it");
  const listingCreate = await api("POST", "/marketplace", {
    hackathon_id: proposal.hackathonId,
    team_id: teamId,
    role_title: "Backend Dev",
    role_type: "builder",
    role_description: "Build the API and review final submission.",
    repo_url: REPO_URL,
    share_pct: 40,
  }, leader.key);
  assertEqual(listingCreate.status, 201, "Marketplace listing created");
  const listingId = listingCreate.json.data.id;
  const browseListing = await api("GET", `/marketplace?hackathon_id=${proposal.hackathonId}&status=open`);
  const openListing = Array.isArray(browseListing.json?.data)
    ? browseListing.json.data.find((listing) => listing.id === listingId)
    : null;
  assert(!!openListing, "Listing appears in open marketplace feed");
  if (identity.attempted && identity.linked) {
    assertEqual(openListing?.poster_identity?.linked, true, "Marketplace listing surfaces linked ERC-8004 identity");
  }
  const take = await api("POST", `/marketplace/${listingId}/take`, {}, hired.key);
  assert(take.ok, "Hired member claims marketplace listing", JSON.stringify(take.json));

  step("9.", "Team submits repo and admin finalizes split winners on-chain");
  const submit = await api("POST", `/hackathons/${proposal.hackathonId}/teams/${teamId}/submit`, {
    repo_url: REPO_URL,
    notes: "Automated BNB Sepolia on-chain marketplace e2e submission.",
  }, leader.key);
  assert(submit.ok, "Team submission succeeds", JSON.stringify(submit.json));
  const finalize = await api("POST", `/admin/hackathons/${proposal.hackathonId}/finalize`, {
    winner_team_id: teamId,
    notes: "Automated BNB Sepolia USDC finalization test.",
  }, ADMIN_API_KEY);
  assert(finalize.ok, "Admin finalize succeeds", JSON.stringify(finalize.json));
  assertEqual(finalize.json.data.winners.length, 2, "Finalize returns two winner entries");
  const winnersByWallet = new Map(
    finalize.json.data.winners.map((winner) => [winner.wallet.toLowerCase(), winner]),
  );
  const leaderWinner = winnersByWallet.get(leaderWallet.account.address.toLowerCase());
  const hiredWinner = winnersByWallet.get(hiredWallet.account.address.toLowerCase());
  assertEqual(leaderWinner?.share_bps, 6000, "Leader keeps 60% after 40% marketplace listing");
  assertEqual(hiredWinner?.share_bps, 4000, "Hired member receives 40%");

  step("10.", "Both members claim USDC prizes and escrow reaches zero");
  const totalPrizeAtFinalize = await publicClient.readContract({
    address: deploy.escrowAddress,
    abi: escrowAbi,
    functionName: "totalPrizeAtFinalize",
  });
  const leaderExpected = (totalPrizeAtFinalize * 6000n) / 10000n;
  const hiredExpected = (totalPrizeAtFinalize * 4000n) / 10000n;
  const [leaderBefore, hiredBefore] = await Promise.all([
    getUsdcBalance(leaderWallet.account.address),
    getUsdcBalance(hiredWallet.account.address),
  ]);
  await claimPrize(leaderWallet, deploy.escrowAddress);
  await claimPrize(hiredWallet, deploy.escrowAddress);
  const [leaderAfter, hiredAfter, finalPrizePool] = await Promise.all([
    getUsdcBalance(leaderWallet.account.address),
    getUsdcBalance(hiredWallet.account.address),
    publicClient.readContract({ address: deploy.escrowAddress, abi: escrowAbi, functionName: "prizePool" }),
  ]);
  assertBigInt(leaderAfter - leaderBefore, leaderExpected, "Leader receives exact USDC winner share");
  assertBigInt(hiredAfter - hiredBefore, hiredExpected, "Hired member receives exact USDC winner share");
  assertBigInt(finalPrizePool, 0n, "Escrow prize pool reaches zero after all claims");

  console.log("\n------------------------------------------------------------");
  console.log(` Hackathon ID:     ${proposal.hackathonId}`);
  console.log(` Proposal ID:      ${proposal.proposalId}`);
  console.log(` Escrow:           ${deploy.escrowAddress}`);
  console.log(` Team ID:          ${teamId}`);
  console.log(` Total prize:      ${formatUnits(totalPrizeAtFinalize, USDC_DECIMALS)} ${USDC_SYMBOL}`);
  console.log(` Leader wallet:    ${leaderWallet.account.address}`);
  console.log(` Hired wallet:     ${hiredWallet.account.address}`);
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
