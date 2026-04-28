#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { privateKeyToAccount } from "viem/accounts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const contractsRoot = path.resolve(appRoot, "../hackaclaw-contracts");

loadEnvFile(path.join(contractsRoot, ".env"));
loadEnvFile(path.join(appRoot, ".env.local"), { override: true });
loadEnvFile(path.join(appRoot, ".env"), { override: true });

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://localhost:3000");
const RPC_URL = requiredEnv("RPC_URL");
requiredEnv("CHAIN_ID");
const ORGANIZER_PRIVATE_KEY = normalizePrivateKey(requiredEnv("ORGANIZER_PRIVATE_KEY"));
const ADMIN_API_KEY = requiredEnv("ADMIN_API_KEY");
const ENTRY_FEE_WEI = toBigInt(process.env.ENTRY_FEE_WEI || "0", "ENTRY_FEE_WEI");
const BOUNTY_WEI = toBigInt(process.env.BOUNTY_WEI || "100000000000000", "BOUNTY_WEI");
const PARTICIPANT_FUNDING_WEI = toBigInt(process.env.PARTICIPANT_FUNDING_WEI || "50000000000000", "PARTICIPANT_FUNDING_WEI");
const GAS_PRICE_WEI = toBigInt(process.env.TEST_GAS_PRICE_WEI || "50000000", "TEST_GAS_PRICE_WEI");
const DURATION_HOURS = Number.parseInt(process.env.TEST_DURATION_HOURS || "24", 10);

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

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function normalizeBaseUrl(value) {
  return value.replace("://localhost:", "://127.0.0.1:");
}

function toBigInt(value, label) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be a valid integer string`);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || appRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(options.env || {}) },
  }).trim();
}

function formatExecError(command, args, error) {
  const stdout = error.stdout ? error.stdout.toString() : "";
  const stderr = error.stderr ? error.stderr.toString() : "";
  return [`Command failed: ${command} ${args.join(" ")}`, stdout, stderr].filter(Boolean).join("\n");
}

function parseJsonOutput(command, args, options = {}) {
  const output = run(command, args, options);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Failed to parse JSON output from ${command}: ${output}`);
  }
}

async function api(method, apiPath, body, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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

      if (!response.ok || json.success === false) {
        throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(json)}`);
      }

      return json;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : String(lastError));
}

async function waitForPrizePoolZero(hackathonId, attempts = 8, delayMs = 2000) {
  let lastValue = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await api("GET", `/hackathons/${hackathonId}/contract`);
    lastValue = state.data.status?.prize_pool_wei ?? null;
    if (lastValue === "0") return state;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`prize_pool_wei after claim mismatch: expected 0, got ${lastValue}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function logStep(step, message) {
  console.log(`\n${step} ${message}`);
}

function makeAgentName(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function generateParticipantWallet() {
  let privateKey;
  do {
    privateKey = `0x${crypto.randomBytes(32).toString("hex")}`;
  } while (/^0x0+$/.test(privateKey));

  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

function getAddressFromPrivateKey(privateKey) {
  return run("cast", ["wallet", "address", "--private-key", privateKey], { cwd: contractsRoot });
}

function getBalance(address) {
  return BigInt(run("cast", ["balance", address, "--rpc-url", RPC_URL], { cwd: contractsRoot }));
}

function getPendingNonce(address) {
  return run("cast", ["nonce", address, "--rpc-url", RPC_URL, "--block", "pending"], { cwd: contractsRoot });
}

function sendTx(fromPrivateKey, to, valueWei, dataArgs = [], confirmations = 1) {
  const args = [
    "send",
    to,
    ...dataArgs,
    "--confirmations",
    String(confirmations),
    "--value",
    valueWei.toString(),
    "--gas-price",
    GAS_PRICE_WEI.toString(),
    "--rpc-url",
    RPC_URL,
    "--private-key",
    fromPrivateKey,
    "--json",
  ];
  return parseJsonOutput("cast", args, { cwd: contractsRoot });
}

function callContract(address, signature, extraArgs = []) {
  return run("cast", ["call", address, signature, ...extraArgs, "--rpc-url", RPC_URL], { cwd: contractsRoot });
}

function deployEscrow(deadlineUnix, organizerAddress) {
  let nonce = getPendingNonce(organizerAddress);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const args = [
      "create",
      "src/HackathonEscrow.sol:HackathonEscrow",
      "--broadcast",
      "--rpc-url",
      RPC_URL,
      "--private-key",
      ORGANIZER_PRIVATE_KEY,
      "--value",
      BOUNTY_WEI.toString(),
      "--gas-price",
      GAS_PRICE_WEI.toString(),
      "--nonce",
      nonce,
      "--constructor-args",
      ENTRY_FEE_WEI.toString(),
      deadlineUnix.toString(),
      organizerAddress,
    ];

    try {
      const output = run("forge", args, { cwd: contractsRoot });
      const match = output.match(/Deployed to:\s*(0x[a-fA-F0-9]{40})/);
      if (!match) throw new Error(`Could not parse escrow address from forge output:\n${output}`);
      return { escrowAddress: match[1], output };
    } catch (error) {
      const message = formatExecError("forge", args, error);
      const nextNonceMatch = message.match(/next nonce (\d+)/i);
      if (!nextNonceMatch) throw new Error(message);
      nonce = nextNonceMatch[1];
    }
  }

  throw new Error("Failed to deploy escrow after nonce retries");
}

async function main() {
  const organizerAddress = getAddressFromPrivateKey(ORGANIZER_PRIVATE_KEY);
  const organizerBalance = getBalance(organizerAddress);
  const minimumRequired = BOUNTY_WEI + PARTICIPANT_FUNDING_WEI;
  if (organizerBalance <= minimumRequired) {
    throw new Error(
      `Organizer wallet ${organizerAddress} is underfunded. Need more than ${minimumRequired} wei, have ${organizerBalance} wei.`
    );
  }

  const participantWallet = generateParticipantWallet();
  const deadlineUnix = Math.floor(Date.now() / 1000) + DURATION_HOURS * 60 * 60;
  const endsAt = new Date(deadlineUnix * 1000).toISOString();

  logStep("1.", "Registering fresh participant agent with a fresh wallet");
  const participant = await api("POST", "/agents/register", {
    name: makeAgentName("onchain_participant"),
    display_name: "On-Chain Participant",
    model: "openai",
    wallet_address: participantWallet.address,
  });
  const participantKey = participant.data.agent.api_key;
  const participantAgentId = participant.data.agent.id;
  console.log(`Participant agent: ${participantAgentId}`);
  console.log(`Participant wallet: ${participantWallet.address}`);

  logStep("2.", "Funding the fresh participant wallet for gas");
  const fundingTx = sendTx(ORGANIZER_PRIVATE_KEY, participantWallet.address, PARTICIPANT_FUNDING_WEI);
  console.log(`Funding tx: ${fundingTx.transactionHash}`);

  logStep("3.", "Deploying funded escrow contract");
  const { escrowAddress } = deployEscrow(deadlineUnix, organizerAddress);
  console.log(`Escrow: ${escrowAddress}`);

  logStep("4.", "Submitting enterprise proposal with the deployed escrow");
  const proposal = await api("POST", "/proposals", {
    company: `On-Chain Test Co ${Date.now()}`,
    email: `onchain-test-${Date.now()}@example.com`,
    track: "api",
    problem: "Verify the full on-chain join, finalize, and claim flow against a funded escrow.",
    judge_agent: "platform",
    prize_amount: "0",
    judging_priorities: "End-to-end integration reliability.",
    tech_requirements: "Contract-backed hackathon with repo submission.",
    hackathon_title: `On-Chain Prize Flow ${Date.now()}`,
    hackathon_brief: "End-to-end test for on-chain join, backend verification, finalization, and claim.",
    hackathon_rules: "Fresh participant wallet must join on-chain before backend registration.",
    hackathon_deadline: endsAt,
    hackathon_min_participants: 2,
    challenge_type: "api",
    contract_address: escrowAddress,
    chain_id: Number(process.env.CHAIN_ID),
  });
  const proposalId = proposal.data.id;
  console.log(`Proposal: ${proposalId}`);

  logStep("5.", "Approving proposal to auto-create the hackathon");
  const approval = await api("PATCH", "/proposals", {
    id: proposalId,
    status: "approved",
    notes: "Automated contract-backed E2E approval.",
  }, ADMIN_API_KEY);
  const hackathonId = approval.data.hackathon_id;
  assertEqual(approval.data.contract_address, escrowAddress, "approved contract_address");
  console.log(`Hackathon: ${hackathonId}`);

  logStep("6.", "Submitting on-chain join transaction from the fresh participant wallet");
  const joinTx = sendTx(participantWallet.privateKey, escrowAddress, ENTRY_FEE_WEI, ["join()"]) ;
  console.log(`Join tx: ${joinTx.transactionHash}`);

  logStep("7.", "Notifying backend with tx proof");
  const joinResponse = await api("POST", `/hackathons/${hackathonId}/join`, {
    tx_hash: joinTx.transactionHash,
    wallet_address: participantWallet.address,
  }, participantKey);
  console.log(`Team: ${joinResponse.data.team.id}`);

  logStep("8.", "Validating live contract state through the backend");
  const contractState = await api("GET", `/hackathons/${hackathonId}/contract`);
  const expectedPrizePoolBeforeFinalize = (BOUNTY_WEI + ENTRY_FEE_WEI).toString();
  assertEqual(contractState.data.contract_address, escrowAddress, "contract endpoint address");
  assertEqual(contractState.data.status.entry_fee_wei, ENTRY_FEE_WEI.toString(), "entry_fee_wei");
  assertEqual(contractState.data.status.prize_pool_wei, expectedPrizePoolBeforeFinalize, "prize_pool_wei before finalize");
  assertEqual(callContract(escrowAddress, "hasJoined(address)(bool)", [participantWallet.address]), "true", "on-chain joined flag");
  console.log(`Prize pool before finalize: ${contractState.data.status.prize_pool_wei} wei`);

  logStep("9.", "Finalizing hackathon through the backend admin endpoint");
  const finalizeResponse = await api(
    "POST",
    `/admin/hackathons/${hackathonId}/finalize`,
    { winner_agent_id: participantAgentId, notes: "Automated on-chain prize flow test winner." },
    ADMIN_API_KEY
  );
  console.log(`Finalize winner: ${finalizeResponse.data.winner_agent_id}`);

  logStep("10.", "Claiming the funded prize from the fresh participant wallet");
  const claimTx = sendTx(participantWallet.privateKey, escrowAddress, 0n, ["claim()"], 3);
  console.log(`Claim tx: ${claimTx.transactionHash}`);

  logStep("11.", "Verifying the prize pool was emptied after claim");
  await waitForPrizePoolZero(hackathonId);
  console.log("Prize pool after claim: 0 wei");

  console.log("\nDone.");
  console.log(`- Hackathon: ${hackathonId}`);
  console.log(`- Escrow: ${escrowAddress}`);
  console.log(`- Participant wallet: ${participantWallet.address}`);
  console.log(`- Funding tx: ${fundingTx.transactionHash}`);
  console.log(`- Join tx: ${joinTx.transactionHash}`);
  console.log(`- Claim tx: ${claimTx.transactionHash}`);
}

main().catch((error) => {
  console.error(`\nFAIL: ${error.message}`);
  process.exit(1);
});
