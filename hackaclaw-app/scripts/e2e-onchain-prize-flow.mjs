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
  // Need funds for 2 escrow deploys (2x bounty) + 3 wallet fundings (leader, hired, single-winner participant)
  const minimumRequired = BOUNTY_WEI * 2n + PARTICIPANT_FUNDING_WEI * 3n;
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
  assertEqual(contractState.data.status.winner_count, 0, "winner_count before finalize");
  assertEqual(callContract(escrowAddress, "hasJoined(address)(bool)", [participantWallet.address]), "true", "on-chain joined flag");
  console.log(`Prize pool before finalize: ${contractState.data.status.prize_pool_wei} wei`);

  logStep("9.", "Finalizing hackathon through the backend admin endpoint");
  const finalizeResponse = await api(
    "POST",
    `/admin/hackathons/${hackathonId}/finalize`,
    { winner_team_id: joinResponse.data.team.id, notes: "Automated on-chain prize flow test winner." },
    ADMIN_API_KEY
  );
  console.log(`Finalize winner team: ${finalizeResponse.data.winner_team_id}`);

  logStep("10.", "Claiming the funded prize from the fresh participant wallet");
  const claimTx = sendTx(participantWallet.privateKey, escrowAddress, 0n, ["claim()"], 3);
  console.log(`Claim tx: ${claimTx.transactionHash}`);

  logStep("11.", "Verifying the prize pool was emptied after claim");
  await waitForPrizePoolZero(hackathonId);
  console.log("Prize pool after claim: 0 wei");

  console.log("\n--- Single-winner scenario complete ---");
  console.log(`- Hackathon: ${hackathonId}`);
  console.log(`- Escrow: ${escrowAddress}`);
  console.log(`- Participant wallet: ${participantWallet.address}`);
  console.log(`- Funding tx: ${fundingTx.transactionHash}`);
  console.log(`- Join tx: ${joinTx.transactionHash}`);
  console.log(`- Claim tx: ${claimTx.transactionHash}`);

  // =========================================================================
  // Multi-winner marketplace scenario
  // =========================================================================
  console.log("\n========== MULTI-WINNER MARKETPLACE SCENARIO ==========");

  const mwDeadlineUnix = Math.floor(Date.now() / 1000) + DURATION_HOURS * 60 * 60;
  const mwEndsAt = new Date(mwDeadlineUnix * 1000).toISOString();

  logStep("12.", "Deploying a fresh escrow for multi-winner scenario");
  const { escrowAddress: mwEscrow } = deployEscrow(mwDeadlineUnix, organizerAddress);
  console.log(`Multi-winner escrow: ${mwEscrow}`);

  logStep("13.", "Creating hackathon via proposal + approval");
  const mwProposal = await api("POST", "/proposals", {
    company: `Multi-Winner Test Co ${Date.now()}`,
    email: `mw-test-${Date.now()}@example.com`,
    track: "api",
    problem: "Verify multi-winner marketplace hire, finalize, and split claim flow.",
    judge_agent: "platform",
    prize_amount: "0",
    judging_priorities: "Multi-winner integration reliability.",
    tech_requirements: "Contract-backed hackathon with marketplace hiring.",
    hackathon_title: `Multi-Winner Flow ${Date.now()}`,
    hackathon_brief: "E2E test: leader joins on-chain, hires teammate via marketplace, both claim split prizes.",
    hackathon_rules: "Leader must join on-chain. Hired member joins via marketplace only.",
    hackathon_deadline: mwEndsAt,
    hackathon_min_participants: 2,
    hackathon_team_size_max: 5,
    challenge_type: "api",
    contract_address: mwEscrow,
    chain_id: Number(process.env.CHAIN_ID),
  });
  const mwProposalId = mwProposal.data.id;

  const mwApproval = await api("PATCH", "/proposals", {
    id: mwProposalId,
    status: "approved",
    notes: "Automated multi-winner E2E approval.",
  }, ADMIN_API_KEY);
  const mwHackathonId = mwApproval.data.hackathon_id;
  assertEqual(mwApproval.data.contract_address, mwEscrow, "mw approved contract_address");
  console.log(`Hackathon: ${mwHackathonId}`);

  logStep("14.", "Registering leader agent with fresh wallet");
  const leaderWallet = generateParticipantWallet();
  const leaderFundTx = sendTx(ORGANIZER_PRIVATE_KEY, leaderWallet.address, PARTICIPANT_FUNDING_WEI);
  console.log(`Leader wallet: ${leaderWallet.address}`);
  console.log(`Leader funding tx: ${leaderFundTx.transactionHash}`);

  const leaderReg = await api("POST", "/agents/register", {
    name: makeAgentName("mw_leader"),
    display_name: "Multi-Winner Leader",
    model: "openai",
    wallet_address: leaderWallet.address,
  });
  const leaderKey = leaderReg.data.agent.api_key;
  const leaderAgentId = leaderReg.data.agent.id;
  console.log(`Leader agent: ${leaderAgentId}`);

  logStep("15.", "Leader joins on-chain + backend");
  const leaderJoinTx = sendTx(leaderWallet.privateKey, mwEscrow, ENTRY_FEE_WEI, ["join()"]);
  console.log(`Leader join tx: ${leaderJoinTx.transactionHash}`);

  const leaderJoinResp = await api("POST", `/hackathons/${mwHackathonId}/join`, {
    tx_hash: leaderJoinTx.transactionHash,
    wallet_address: leaderWallet.address,
  }, leaderKey);
  const mwTeamId = leaderJoinResp.data.team.id;
  console.log(`Team: ${mwTeamId}`);

  logStep("16.", "Registering hired agent with fresh wallet");
  const hiredWallet = generateParticipantWallet();
  console.log(`Hired wallet: ${hiredWallet.address}`);

  const hiredReg = await api("POST", "/agents/register", {
    name: makeAgentName("mw_hired"),
    display_name: "Multi-Winner Hired Member",
    model: "openai",
    wallet_address: hiredWallet.address,
  });
  const hiredKey = hiredReg.data.agent.api_key;
  const hiredAgentId = hiredReg.data.agent.id;
  console.log(`Hired agent: ${hiredAgentId}`);

  logStep("17.", "Hired agent creates marketplace listing");
  const listing = await api("POST", "/marketplace", {
    hackathon_id: mwHackathonId,
    skills: "Solidity, TypeScript, Testing",
    asking_share_pct: 30,
    description: "E2E test hired member",
  }, hiredKey);
  const listingId = listing.data.id;
  console.log(`Listing: ${listingId}`);

  logStep("18.", "Leader sends hire offer (40% share)");
  const offer = await api("POST", "/marketplace/offers", {
    listing_id: listingId,
    team_id: mwTeamId,
    offered_share_pct: 40,
    role: "backend",
    message: "Join us for the multi-winner E2E test.",
  }, leaderKey);
  const offerId = offer.data.id;
  assertEqual(offer.data.leader_share_after, 60, "leader_share_after on offer");
  console.log(`Offer: ${offerId}, leader share after: ${offer.data.leader_share_after}%`);

  logStep("19.", "Hired agent accepts the offer");
  const acceptResp = await api("PATCH", `/marketplace/offers/${offerId}`, {
    action: "accept",
  }, hiredKey);
  assertEqual(acceptResp.data.status, "accepted", "offer status");
  assertEqual(acceptResp.data.your_share_pct, 40, "hired share_pct");
  assertEqual(acceptResp.data.leader_share_after, 60, "leader_share_after on accept");
  console.log(`Accepted: hired gets ${acceptResp.data.your_share_pct}%, leader keeps ${acceptResp.data.leader_share_after}%`);

  logStep("20.", "Submitting repo from the team");
  await api("POST", `/hackathons/${mwHackathonId}/teams/${mwTeamId}/submit`, {
    repo_url: "https://github.com/hackaclaw/multi-winner-e2e-test",
    notes: "Automated multi-winner E2E test submission.",
  }, leaderKey);
  console.log("Submission recorded");

  logStep("21.", "Finalizing with winner_team_id (multi-winner split)");
  const mwFinalizeResp = await api(
    "POST",
    `/admin/hackathons/${mwHackathonId}/finalize`,
    { winner_team_id: mwTeamId, notes: "Automated multi-winner prize flow test." },
    ADMIN_API_KEY
  );
  assertEqual(mwFinalizeResp.data.winners.length, 2, "winners count");
  console.log(`Finalize tx: ${mwFinalizeResp.data.hackathon?.finalize_tx_hash || "in metadata"}`);
  console.log("Winners:");
  for (const w of mwFinalizeResp.data.winners) {
    console.log(`  ${w.wallet}: ${w.share_bps} bps`);
  }

  // Verify on-chain state
  const mwContractState = await api("GET", `/hackathons/${mwHackathonId}/contract`);
  assertEqual(mwContractState.data.status.winner_count, 2, "on-chain winner_count");
  console.log(`On-chain prize pool at finalize: ${mwContractState.data.status.total_prize_at_finalize_wei} wei`);

  logStep("22.", "Both members claim their prizes independently");
  // Fund hired wallet for gas (they never called join, so they have no funds)
  const hiredGasTx = sendTx(ORGANIZER_PRIVATE_KEY, hiredWallet.address, PARTICIPANT_FUNDING_WEI);
  console.log(`Hired gas funding tx: ${hiredGasTx.transactionHash}`);

  const leaderBalBefore = getBalance(leaderWallet.address);
  const hiredBalBefore = getBalance(hiredWallet.address);

  // Leader claims
  const leaderClaimTx = sendTx(leaderWallet.privateKey, mwEscrow, 0n, ["claim()"], 3);
  console.log(`Leader claim tx: ${leaderClaimTx.transactionHash}`);

  // Hired member claims — this proves non-joined addresses can claim after finalize
  const hiredClaimTx = sendTx(hiredWallet.privateKey, mwEscrow, 0n, ["claim()"], 3);
  console.log(`Hired claim tx: ${hiredClaimTx.transactionHash}`);

  const leaderBalAfter = getBalance(leaderWallet.address);
  const hiredBalAfter = getBalance(hiredWallet.address);

  // Calculate expected prizes from the bounty
  const totalPrize = BOUNTY_WEI + ENTRY_FEE_WEI;
  const expectedLeaderPrize = (totalPrize * 6000n) / 10000n;
  const expectedHiredPrize = (totalPrize * 4000n) / 10000n;

  // Balance increase = prize - gas cost, so just verify balance went up by at least 90% of expected
  const leaderGain = leaderBalAfter - leaderBalBefore;
  const hiredGain = hiredBalAfter - hiredBalBefore;
  if (leaderGain < (expectedLeaderPrize * 90n) / 100n) {
    throw new Error(`Leader prize too low: gained ${leaderGain} wei, expected ~${expectedLeaderPrize} wei`);
  }
  if (hiredGain < (expectedHiredPrize * 90n) / 100n) {
    throw new Error(`Hired prize too low: gained ${hiredGain} wei, expected ~${expectedHiredPrize} wei`);
  }
  console.log(`Leader gained: ${leaderGain} wei (expected ~${expectedLeaderPrize})`);
  console.log(`Hired gained: ${hiredGain} wei (expected ~${expectedHiredPrize})`);

  logStep("23.", "Verifying prize pool emptied after both claims");
  await waitForPrizePoolZero(mwHackathonId);
  console.log("Prize pool after both claims: 0 wei");

  console.log("\n--- Multi-winner marketplace scenario complete ---");
  console.log(`- Hackathon: ${mwHackathonId}`);
  console.log(`- Escrow: ${mwEscrow}`);
  console.log(`- Leader wallet: ${leaderWallet.address}`);
  console.log(`- Hired wallet: ${hiredWallet.address} (never called join())`);
  console.log(`- Leader claim tx: ${leaderClaimTx.transactionHash}`);
  console.log(`- Hired claim tx: ${hiredClaimTx.transactionHash}`);

  console.log("\n========== ALL SCENARIOS PASSED ==========");
}

main().catch((error) => {
  console.error(`\nFAIL: ${error.message}`);
  process.exit(1);
});
