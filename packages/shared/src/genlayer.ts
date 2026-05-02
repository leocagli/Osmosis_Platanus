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
const GENLAYER_RPC_RETRY_ATTEMPTS = 4;
const GENLAYER_RPC_RETRY_INTERVAL_MS = 1500;
const GENLAYER_JUDGE_CONTRACT = "contracts/hackathon_judge.py";

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

export interface GenLayerProgress {
  done: boolean;
  status?: string;
  contractAddress?: string;
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

async function resolveGenLayerContractPath(): Promise<string> {
  const { existsSync } = await import("fs");
  const { resolve } = await import("path");
  const candidates = [
    resolve(process.cwd(), "apps/genlayer", GENLAYER_JUDGE_CONTRACT),
    resolve(process.cwd(), "../genlayer", GENLAYER_JUDGE_CONTRACT),
    resolve(process.cwd(), "genlayer", GENLAYER_JUDGE_CONTRACT),
  ];

  const contractPath = candidates.find((path) => existsSync(path));
  if (!contractPath) {
    throw new Error(`[GenLayer] Contract not found. Checked: ${candidates.join(", ")}`);
  }
  return contractPath;
}

async function makeClient() {
  if (!GENLAYER_PK) throw new Error("GENLAYER_PRIVATE_KEY not configured");

  const account = createAccount(GENLAYER_PK as `0x${string}`);
  const client = createClient({
    chain: getChain() as typeof chains.testnetBradbury,
    account,
    endpoint: GENLAYER_RPC,
  });

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

function formatGenLayerError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableGenLayerRpcError(error: unknown) {
  const message = formatGenLayerError(error).toLowerCase();
  return message.includes("fetch failed")
    || message.includes("an unknown rpc error occurred")
    || message.includes("json is not a valid request object")
    || message.includes("requested resource not found")
    || message.includes("contract not found at address")
    || message.includes("etimedout")
    || message.includes("enetunreach");
}

async function withGenLayerRetry<T>(label: string, work: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GENLAYER_RPC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isRetryableGenLayerRpcError(error) || attempt === GENLAYER_RPC_RETRY_ATTEMPTS) {
        throw error;
      }

      console.warn(`[GenLayer] ${label} retry ${attempt}/${GENLAYER_RPC_RETRY_ATTEMPTS}: ${formatGenLayerError(error)}`);
      await sleep(GENLAYER_RPC_RETRY_INTERVAL_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  const executionResult = String(receipt.txExecutionResultName ?? "").toUpperCase();
  if (executionResult === "FINISHED_WITH_ERROR") {
    throw new Error(`[GenLayer] ${action} execution finished with error. Receipt: ${JSON.stringify(receipt, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  }

  if (!isAcceptedReceipt(receipt)) {
    throw new Error(
      `[GenLayer] ${action} failed. Receipt: ${JSON.stringify(receipt, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`
    );
  }
}

function contractAddressFromReceipt(receipt: GenLayerReceipt): string | undefined {
  const data = receipt.data as Record<string, unknown> | undefined;
  const decoded = receipt.txDataDecoded as Record<string, unknown> | undefined;

  return data?.contract_address as string
    ?? decoded?.contractAddress as string
    ?? receipt.recipient as string
    ?? receipt.contractAddress as string;
}

async function getTransactionReceipt(txHash: string): Promise<GenLayerReceipt> {
  const { client } = await makeClient();
  return await withGenLayerRetry(
    `getTransaction(${txHash})`,
    async () => await client.getTransaction({ hash: txHash as TransactionHash }) as GenLayerReceipt,
  );
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
  const contractPath = await resolveGenLayerContractPath();

  const contractCode = new Uint8Array(readFileSync(contractPath));

  const { client } = await makeClient();

  console.log(`[GenLayer] Deploying HackathonJudge for hackathon ${hackathonId}...`);

  const deployTx = await client.deployContract({
    code: contractCode,
    args: [hackathonId, title, brief],
    leaderOnly: false,
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
    leaderOnly:   false,
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

  const raw = await withGenLayerRetry(
    `readContract(${contractAddress}).get_result`,
    async () => await client.readContract({
      address:      contractAddress as `0x${string}`,
      functionName: "get_result",
      args:         [],
    }) as Record<string, unknown>,
  );

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

export function buildContendersPayload(topContenders: GenLayerContender[]): string {
  return JSON.stringify(topContenders.map((c) => ({
    team_id: c.team_id,
    team_name: c.team_name,
    repo_summary: c.repo_summary.slice(0, 1500),
    gemini_score: Math.round(c.gemini_score),
  })));
}

export async function startGenLayerDeployment(
  hackathonId: string,
  hackathonTitle: string,
  hackathonBrief: string,
): Promise<{ txHash: string }> {
  const { readFileSync } = await import("fs");
  const contractPath = await resolveGenLayerContractPath();
  const contractCode = new Uint8Array(readFileSync(contractPath));
  const { client } = await makeClient();

  console.log(`[GenLayer] Deploying HackathonJudge for hackathon ${hackathonId}...`);
  const txHash = await client.deployContract({
    code: contractCode,
    args: [hackathonId, hackathonTitle, hackathonBrief],
    leaderOnly: false,
  });

  return { txHash: String(txHash) };
}

export async function pollGenLayerDeployment(txHash: string): Promise<GenLayerProgress> {
  const receipt = await getTransactionReceipt(txHash);
  const status = statusNameOf(receipt);
  const executionResult = String(receipt.txExecutionResultName ?? "").toUpperCase();

  if (status === "CANCELED" || status === "UNDETERMINED") {
    throw new Error(`[GenLayer] Deployment entered terminal status ${status}`);
  }

  if (executionResult === "FINISHED_WITH_ERROR") {
    throw new Error(`[GenLayer] Deployment ${txHash} finished with execution error`);
  }

  if (!isAcceptedReceipt(receipt)) {
    return { done: false, status };
  }

  const contractAddress = contractAddressFromReceipt(receipt);
  if (!contractAddress) {
    throw new Error(`[GenLayer] Could not extract contract address from deployment receipt: ${JSON.stringify(receipt, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  }

  return { done: true, status, contractAddress };
}

export async function startGenLayerSubmit(
  contractAddress: string,
  topContenders: GenLayerContender[],
): Promise<{ txHash: string }> {
  const { client } = await makeClient();
  const txHash = await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: "submit_contenders",
    args: [buildContendersPayload(topContenders)],
    value: BigInt(0),
    leaderOnly: false,
  });

  return { txHash: String(txHash) };
}

export async function pollGenLayerWrite(
  txHash: string,
  status: TransactionStatus = TransactionStatus.ACCEPTED,
): Promise<GenLayerProgress> {
  const receipt = await getTransactionReceipt(txHash);
  const currentStatus = statusNameOf(receipt);
  const executionResult = String(receipt.txExecutionResultName ?? "").toUpperCase();
  const targetStatus = String(status).toUpperCase();
  const currentRank = currentStatus ? STATUS_RANK[currentStatus] : undefined;
  const targetRank = STATUS_RANK[targetStatus];

  if (currentStatus === "CANCELED" || currentStatus === "UNDETERMINED") {
    throw new Error(`[GenLayer] Transaction ${txHash} entered terminal status ${currentStatus}`);
  }

  if (executionResult === "FINISHED_WITH_ERROR") {
    throw new Error(`[GenLayer] Transaction ${txHash} finished with execution error`);
  }

  if (currentRank !== undefined && targetRank !== undefined && currentRank >= targetRank) {
    return { done: true, status: currentStatus };
  }

  return { done: false, status: currentStatus };
}

export async function startGenLayerFinalize(contractAddress: string): Promise<{ txHash: string }> {
  const { client } = await makeClient();
  const txHash = await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: "finalize",
    args: [],
    value: BigInt(0),
    leaderOnly: false,
  });

  return { txHash: String(txHash) };
}

export async function getGenLayerJudgeResult(
  contractAddress: string,
  hackathonId: string,
): Promise<GenLayerJudgeResult> {
  return await readJudgeResult(contractAddress, hackathonId);
}

async function waitForJudgeResult(
  contractAddress: string,
  hackathonId: string,
  finalizeTxHash: string,
  retries = 80,
  intervalMs = 15000,
): Promise<GenLayerJudgeResult> {
  let lastStatus: string | undefined;
  let lastReadError: string | null = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await readJudgeResult(contractAddress, hackathonId);
      if (result.finalized) {
        return result;
      }
      console.log(`[GenLayer] finalize() result poll ${attempt}: finalized=false`);
    } catch (error) {
      lastReadError = formatGenLayerError(error);
      console.warn(`[GenLayer] finalize() result poll ${attempt} failed: ${lastReadError}`);
    }

    try {
      const progress = await pollGenLayerWrite(finalizeTxHash, TransactionStatus.FINALIZED);
      lastStatus = progress.status;
      console.log(`[GenLayer] finalize() tx poll ${attempt}: ${progress.status ?? "unknown"}`);
      if (progress.done) {
        const result = await readJudgeResult(contractAddress, hackathonId);
        if (result.finalized) {
          return result;
        }
      }
    } catch (error) {
      const message = formatGenLayerError(error);
      if (message.includes("entered terminal status") || message.includes("finished with execution error")) {
        throw error;
      }
      console.warn(`[GenLayer] finalize() tx poll ${attempt} failed: ${message}`);
    }

    await sleep(intervalMs);
  }

  const details = lastReadError
    ? ` Last result read error: ${lastReadError}`
    : lastStatus
      ? ` Last finalize tx status: ${lastStatus}`
      : "";
  throw new Error(`[GenLayer] Timed out waiting for finalized result for contract ${contractAddress}.${details}`);
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
  const contendersPayload = buildContendersPayload(topContenders);

  console.log(`[GenLayer] Submitting ${topContenders.length} contenders...`);
  const submit = await callWrite(contractAddress, "submit_contenders", [contendersPayload], TransactionStatus.ACCEPTED);

  // 3. Finalize — triggers LLM consensus among 5 validators.
  // Bradbury may keep receipt polling noisy for a while even after the contract
  // has already written the final result, so poll both tx status and contract state.
  console.log(`[GenLayer] Triggering finalize() — 5 validators will run LLM consensus...`);
  const finalize = await callWrite(contractAddress, "finalize", [], TransactionStatus.ACCEPTED);

  // 4. Read the result
  const result = await waitForJudgeResult(contractAddress, hackathonId, finalize.txHash);
  console.log(`[GenLayer] Winner: ${result.winner_team_name ?? "none"} (${result.winner_team_id ?? "none"})`);

  return {
    ...result,
    deploy_tx_hash: deployment.txHash,
    submit_tx_hash: submit.txHash,
    finalize_tx_hash: finalize.txHash,
  };
}
