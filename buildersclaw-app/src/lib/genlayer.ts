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
const GENLAYER_CHAIN = (process.env.GENLAYER_CHAIN || "bradbury").trim().toLowerCase();

// ─── Types ───

export interface GenLayerContender {
  team_id:      string;
  team_name:    string;
  /** Gemini's structured evaluation (2-4 paragraphs). Used as the main context
   *  for validators — more informative than raw code snippets. */
  repo_summary: string;
  gemini_score: number;
}

export interface GenLayerJudgeResult {
  finalized:         boolean;
  hackathon_id:      string;
  winner_team_id?:   string;
  winner_team_name?: string;
  final_score?:      number;
  reasoning?:        string;
  contractAddress:   string;
  deploy_tx_hash?:   string;
  submit_tx_hash?:   string;
  finalize_tx_hash?: string;
}

// ─── Client factory ───

function getChain() {
  switch (GENLAYER_CHAIN) {
    case "localnet":
    case "local":
      return chains.localnet;
    case "studionet":
    case "studio":
      return chains.studionet;
    case "asimov":
    case "testnet_asimov":
    case "testnet-asimov":
      return chains.testnetAsimov;
    case "bradbury":
    case "testnet_bradbury":
    case "testnet-bradbury":
      return chains.testnetBradbury;
    default:
      throw new Error(`Unsupported GENLAYER_CHAIN \"${GENLAYER_CHAIN}\"`);
  }
}

async function makeClient() {
  if (!GENLAYER_PK) throw new Error("GENLAYER_PRIVATE_KEY not configured");

  const account = createAccount(GENLAYER_PK as `0x${string}`);
  const client = createClient({
    chain: getChain() as typeof chains.testnetBradbury,
    account,
    endpoint: GENLAYER_RPC,
  });

  // The SDK docs require consensus initialization before contract interactions.
  await client.initializeConsensusSmartContract();

  return { client, account };
}

// ─── Contract interaction helpers ───

type GenLayerReceipt = Record<string, unknown>;
const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  PROPOSING: 1,
  COMMITTING: 2,
  REVEALING: 3,
  ACCEPTED: 4,
  FINALIZED: 5,
  UNDETERMINED: 6,
  CANCELED: 7,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusNameOf(receipt: GenLayerReceipt): string | undefined {
  const raw =
    (receipt.status_name as string | undefined)
    ?? (receipt.statusName as string | undefined)
    ?? (typeof receipt.status === "string" ? receipt.status : undefined);

  return raw?.toUpperCase();
}

function isAcceptedReceipt(receipt: GenLayerReceipt): boolean {
  const statusRaw = receipt.status;
  const statusNum = statusRaw !== undefined ? Number(statusRaw) : undefined;
  const statusName = statusNameOf(receipt);

  return statusNum === 5 || statusNum === 7
    || statusName === "ACCEPTED"
    || statusName === "FINALIZED";
}

function assertAcceptedReceipt(action: string, receipt: GenLayerReceipt) {
  if (!isAcceptedReceipt(receipt)) {
    throw new Error(
      `[GenLayer] ${action} failed. Receipt: ${JSON.stringify(receipt, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`
    );
  }
}

async function waitForReceipt(
  client: Awaited<ReturnType<typeof makeClient>>["client"],
  txHash: string,
  status: TransactionStatus = TransactionStatus.FINALIZED,
  retries = 240,
  intervalMs = 5000,
) {
  const targetStatus = String(status).toUpperCase();
  const targetRank = STATUS_RANK[targetStatus];

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const tx = await client.getTransaction({ hash: txHash as TransactionHash }) as GenLayerReceipt;
      const currentStatus = statusNameOf(tx);

      if (currentStatus === "CANCELED" || currentStatus === "UNDETERMINED") {
        throw new Error(`[GenLayer] Transaction ${txHash} entered terminal status ${currentStatus}`);
      }

      if (currentStatus) {
        const currentRank = STATUS_RANK[currentStatus];
        if (currentRank !== undefined && targetRank !== undefined && currentRank >= targetRank) {
          return tx;
        }
      }
    } catch (err) {
      if (attempt === retries - 1) {
        throw err;
      }
    }

    await sleep(intervalMs);
  }

  throw new Error(`[GenLayer] Timed out waiting for transaction ${txHash} to reach ${targetStatus}`);
}

/**
 * Deploy a fresh HackathonJudge contract for a hackathon.
 * Returns the deployed contract address.
 */
async function deployJudgeContract(
  hackathonId: string,
  title: string,
  brief: string,
): Promise<{ contractAddress: string; txHash: string }> {
  const { readFileSync } = await import("fs");
  const { resolve } = await import("path");

  const contractPath = resolve(
    process.cwd(),
    "genlayer/contracts/hackathon_judge.py",
  );

  const contractCode = new Uint8Array(readFileSync(contractPath));

  const { client } = await makeClient();

  console.log(`[GenLayer] Deploying HackathonJudge for hackathon ${hackathonId}...`);

  const deployTx = await client.deployContract({
    code: contractCode,
    args: [hackathonId, title, brief],
  });

  const receipt = await waitForReceipt(client, deployTx as string, TransactionStatus.ACCEPTED, 240, 5000);
  const r = receipt as GenLayerReceipt;
  assertAcceptedReceipt("Deploy", r);

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
  return { contractAddress, txHash: String(deployTx) };
}

/**
 * Call a write method on the contract and wait for it to be accepted.
 */
async function callWrite(
  contractAddress: string,
  functionName: string,
  args: string[],
  status: TransactionStatus = TransactionStatus.ACCEPTED,
) {
  const { client } = await makeClient();

  const txHash = await client.writeContract({
    address:      contractAddress as `0x${string}`,
    functionName,
    args,
    value:        BigInt(0),
  });

  const receipt = await waitForReceipt(client, txHash as string, status, 240, 5000);
  const r2 = receipt as GenLayerReceipt;
  assertAcceptedReceipt(`${functionName}()`, r2);
  console.log(`[GenLayer] ${functionName}() accepted. Status: ${r2.status_name ?? r2.statusName ?? r2.status}`);
  return { txHash: String(txHash), receipt };
}

/**
 * Read the current result from the judge contract (free view call).
 */
async function readJudgeResult(contractAddress: string, hackathonId: string): Promise<GenLayerJudgeResult> {
  const { client } = await makeClient();

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
  if (!GENLAYER_PK) {
    return false;
  }

  try {
    await makeClient();
    return true;
  } catch {
    return false;
  }
}

/**
 * Full pipeline: (optionally reuse existing contract) → submit contenders → finalize → return result.
 *
 * Always deploy a fresh contract for each judging run. The contract stores
 * contenders in persistent storage, so reusing an unfinished contract can mix
 * old and new contender sets across retries.
 */
export async function runGenLayerJudging(
  hackathonId: string,
  hackathonTitle: string,
  hackathonBrief: string,
  topContenders: GenLayerContender[],
  priorContractAddress?: string,
): Promise<GenLayerJudgeResult> {
  console.log(`[GenLayer] Starting on-chain judging for "${hackathonTitle}" with ${topContenders.length} contenders`);

  if (priorContractAddress) {
    console.log(`[GenLayer] Ignoring prior contract ${priorContractAddress} and deploying a fresh judge contract`);
  }

  // 1. Deploy fresh contract
  const deployment = await deployJudgeContract(hackathonId, hackathonTitle, hackathonBrief);
  const contractAddress = deployment.contractAddress;

  // 2. Submit contenders as JSON
  // ⚠ GenLayer Bradbury gas limit: eth_estimateGas fails → SDK falls back to 200k.
  // Intrinsic cost = 21k + 16 gas/byte calldata → payload must stay under ~10KB total.
  // Cap each text field to fit comfortably within the 200k ceiling.
  const contendersPayload = JSON.stringify(topContenders.map(c => ({
    team_id:      c.team_id,
    team_name:    c.team_name,
    repo_summary: c.repo_summary.slice(0, 1500),
    gemini_score: Math.round(c.gemini_score),
  })));

  console.log(`[GenLayer] Submitting ${topContenders.length} contenders...`);
  const submit = await callWrite(contractAddress, "submit_contenders", [contendersPayload], TransactionStatus.ACCEPTED);

  // 3. Finalize — triggers LLM consensus among 5 validators
  console.log(`[GenLayer] Triggering finalize() — 5 validators will run LLM consensus...`);
  const finalize = await callWrite(contractAddress, "finalize", [], TransactionStatus.FINALIZED);

  // 4. Read the result
  const result = await readJudgeResult(contractAddress, hackathonId);
  console.log(`[GenLayer] Winner: ${result.winner_team_name ?? "none"} (${result.winner_team_id ?? "none"})`);

  return {
    ...result,
    deploy_tx_hash: deployment.txHash,
    submit_tx_hash: submit.txHash,
    finalize_tx_hash: finalize.txHash,
  };
}
