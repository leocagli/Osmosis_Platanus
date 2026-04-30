/**
 * GenLayer integration for on-chain hackathon judging.
 *
 * After Gemini pre-scores all submissions, the top 2-3 contenders
 * are sent to a GenLayer Intelligent Contract where 5 independent
 * validators use LLM consensus to pick the winner impartially.
 *
 * The result is stored on-chain and verifiable by anyone.
 */

import {
  createClient,
  createAccount,
  chains,
} from "genlayer-js";
import type { TransactionHash } from "genlayer-js/types";
import { TransactionStatus } from "genlayer-js/types";

// ─── Config ───

const GENLAYER_RPC = process.env.GENLAYER_RPC_URL || "https://rpc-bradbury.genlayer.com";
const GENLAYER_PK  = process.env.GENLAYER_PRIVATE_KEY || "";

// ─── Types ───

export interface GenLayerContender {
  team_id:    string;
  team_name:  string;
  /** Structured repo summary (no raw code, no repo URL for impartiality) */
  repo_summary: string;
  gemini_score: number;
  gemini_feedback: string;
}

export interface GenLayerJudgeResult {
  finalized:         boolean;
  hackathon_id:      string;
  winner_team_id?:   string;
  winner_team_name?: string;
  final_score?:      number;
  reasoning?:        string;
  contractAddress:   string;
}

// ─── Client factory ───

function makeClient() {
  if (!GENLAYER_PK) throw new Error("GENLAYER_PRIVATE_KEY not configured");

  const account = createAccount(GENLAYER_PK as `0x${string}`);
  const client = createClient({
    chain: chains.testnetBradbury as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    account,
    endpoint: GENLAYER_RPC,
  });
  return { client, account };
}

// ─── Contract interaction helpers ───

async function waitForReceipt(client: ReturnType<typeof createClient>, txHash: string, retries = 200) {
  return client.waitForTransactionReceipt({
    hash:    txHash as TransactionHash,
    status:  TransactionStatus.ACCEPTED,
    retries,
  });
}

/**
 * Deploy a fresh HackathonJudge contract for a hackathon.
 * Returns the deployed contract address.
 */
async function deployJudgeContract(
  hackathonId: string,
  title: string,
  brief: string,
): Promise<string> {
  const { readFileSync } = await import("fs");
  const { resolve } = await import("path");

  const contractPath = resolve(
    process.cwd(),
    "genlayer/contracts/hackathon_judge.py",
  );

  const contractCode = new Uint8Array(readFileSync(contractPath));

  const { client } = makeClient();

  console.log(`[GenLayer] Deploying HackathonJudge for hackathon ${hackathonId}...`);

  const deployTx = await client.deployContract({
    code: contractCode,
    args: [hackathonId, title, brief],
  });

  const receipt = await waitForReceipt(client, deployTx as string);

  // v0.27.9: status comes back as BigInt from viem ABI decode; FINALIZED = 7 (not 6)
  // simplifyTransactionReceipt renames statusName → status_name
  const r = receipt as Record<string, unknown>;
  const statusRaw = r.status;
  const statusNum = statusRaw !== undefined ? Number(statusRaw) : undefined;
  const statusName: string | undefined =
    (r.status_name as string | undefined)  // v0.27.9 (renamed by simplifyTransactionReceipt)
    ?? (r.statusName as string | undefined); // older versions
  const isAccepted =
    statusNum === 5 || statusNum === 7        // 5=ACCEPTED, 7=FINALIZED in v0.27.9
    || statusName === "ACCEPTED" || statusName === "FINALIZED";
  if (!isAccepted) {
    throw new Error(`[GenLayer] Deploy failed. Receipt: ${JSON.stringify(receipt, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  }

  const data = r.data as Record<string, unknown> | undefined;
  const decoded = r.txDataDecoded as Record<string, unknown> | undefined;

  const contractAddress: string | undefined =
    data?.contract_address as string      // localnet / older format
    ?? decoded?.contractAddress as string // v0.27.9: txDataDecoded.contractAddress = recipient
    ?? r.recipient as string              // v0.27.9: recipient IS the deployed contract address
    ?? r.contractAddress as string;       // fallback

  if (!contractAddress) {
    throw new Error(`[GenLayer] Could not extract contract address from receipt: ${JSON.stringify(receipt, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  }

  console.log(`[GenLayer] HackathonJudge deployed at ${contractAddress}`);
  return contractAddress;
}

/**
 * Call a write method on the contract and wait for it to be accepted.
 */
async function callWrite(contractAddress: string, functionName: string, args: string[]) {
  const { client } = makeClient();

  const txHash = await client.writeContract({
    address:      contractAddress as `0x${string}`,
    functionName,
    args,
    value:        BigInt(0),
  });

  const receipt = await waitForReceipt(client, txHash as string, 300);
  const r2 = receipt as Record<string, unknown>;
  console.log(`[GenLayer] ${functionName}() accepted. Status: ${r2.status_name ?? r2.statusName ?? r2.status}`);
  return receipt;
}

/**
 * Read the current result from the judge contract (free view call).
 */
async function readJudgeResult(contractAddress: string, hackathonId: string): Promise<GenLayerJudgeResult> {
  const { client } = makeClient();

  const raw = await client.readContract({
    address:      contractAddress as `0x${string}`,
    functionName: "get_result",
    args:         [],
  }) as Record<string, unknown>;

  return {
    finalized:        Boolean(raw.finalized),
    hackathon_id:     String(raw.hackathon_id ?? hackathonId),
    winner_team_id:   raw.winner_team_id   ? String(raw.winner_team_id)   : undefined,
    winner_team_name: raw.winner_team_name ? String(raw.winner_team_name) : undefined,
    final_score:      raw.final_score != null ? Number(raw.final_score)   : undefined,
    reasoning:        raw.reasoning        ? String(raw.reasoning)        : undefined,
    contractAddress,
  };
}

// ─── Public API ───

/**
 * Check if GenLayer Bradbury testnet is reachable.
 */
export async function isGenLayerAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(GENLAYER_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Full pipeline: (optionally reuse existing contract) → submit contenders → finalize → return result.
 *
 * If `priorContractAddress` is given and the contract is not yet finalized,
 * it reuses that contract instead of deploying a new one.
 */
export async function runGenLayerJudging(
  hackathonId: string,
  hackathonTitle: string,
  hackathonBrief: string,
  topContenders: GenLayerContender[],
  priorContractAddress?: string,
): Promise<GenLayerJudgeResult> {
  console.log(`[GenLayer] Starting on-chain judging for "${hackathonTitle}" with ${topContenders.length} contenders`);

  // 1. Determine contract address — reuse if not yet finalized
  let contractAddress: string;

  if (priorContractAddress) {
    try {
      const existing = await readJudgeResult(priorContractAddress, hackathonId);
      if (existing.finalized) {
        // Already finalized — deploy a new one for this run
        console.log(`[GenLayer] Prior contract ${priorContractAddress} already finalized, deploying fresh one`);
        contractAddress = await deployJudgeContract(hackathonId, hackathonTitle, hackathonBrief);
      } else {
        contractAddress = priorContractAddress;
        console.log(`[GenLayer] Reusing contract ${contractAddress}`);
      }
    } catch {
      // Can't read — deploy new
      contractAddress = await deployJudgeContract(hackathonId, hackathonTitle, hackathonBrief);
    }
  } else {
    contractAddress = await deployJudgeContract(hackathonId, hackathonTitle, hackathonBrief);
  }

  // 2. Submit contenders as JSON
  // ⚠ GenLayer Bradbury gas limit: eth_estimateGas fails → SDK falls back to 200k.
  // Intrinsic cost = 21k + 16 gas/byte calldata → payload must stay under ~10KB total.
  // Cap each text field to fit comfortably within the 200k ceiling.
  const contiendersPayload = JSON.stringify(topContenders.map(c => ({
    team_id:         c.team_id,
    team_name:       c.team_name,
    repo_summary:    c.repo_summary.slice(0, 800),
    gemini_score:    Math.round(c.gemini_score),
    gemini_feedback: c.gemini_feedback.slice(0, 600),
  })));

  console.log(`[GenLayer] Submitting ${topContenders.length} contenders...`);
  await callWrite(contractAddress, "submit_contenders", [contiendersPayload]);

  // 3. Finalize — triggers LLM consensus among 5 validators
  console.log(`[GenLayer] Triggering finalize() — 5 validators will run LLM consensus...`);
  await callWrite(contractAddress, "finalize", []);

  // 4. Read the result
  const result = await readJudgeResult(contractAddress, hackathonId);
  console.log(`[GenLayer] Winner: ${result.winner_team_name ?? "none"} (${result.winner_team_id ?? "none"})`);

  return result;
}
