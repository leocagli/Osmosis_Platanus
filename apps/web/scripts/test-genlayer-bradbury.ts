import fs from "fs";
import path from "path";
import { TransactionStatus } from "genlayer-js/types";

const appRoot = process.cwd();

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isReplaceConflict(error: unknown) {
  const message = formatError(error).toLowerCase();
  return message.includes("insufficient gas price to replace existing transaction")
    || message.includes("replacement transaction underpriced");
}

async function retryStart<T>(label: string, fn: () => Promise<T>) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isReplaceConflict(error) || attempt === 5) throw error;
      console.log(`[Bradbury] ${label} start retry ${attempt}: ${formatError(error)}`);
      await sleep(30_000);
    }
  }

  throw new Error(`Unable to start ${label}`);
}

async function waitForDeployment(
  pollGenLayerDeployment: (txHash: string) => Promise<{ done: boolean; status?: string; contractAddress?: string }>,
  txHash: string,
) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const progress = await pollGenLayerDeployment(txHash);
      console.log(`[Bradbury] deploy poll ${attempt}: ${progress.status ?? "unknown"}`);
      if (progress.done && progress.contractAddress) {
        return progress.contractAddress;
      }
    } catch (error) {
      console.log(`[Bradbury] deploy poll ${attempt} failed: ${formatError(error)}`);
    }
    await sleep(10_000);
  }

  throw new Error(`Timed out waiting for deployment ${txHash}`);
}

async function waitForAcceptedWrite(
  pollGenLayerWrite: (txHash: string, status?: TransactionStatus) => Promise<{ done: boolean; status?: string }>,
  txHash: string,
  label: string,
) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const progress = await pollGenLayerWrite(txHash, TransactionStatus.ACCEPTED);
      console.log(`[Bradbury] ${label} poll ${attempt}: ${progress.status ?? "unknown"}`);
      if (progress.done) return;
    } catch (error) {
      console.log(`[Bradbury] ${label} poll ${attempt} failed: ${formatError(error)}`);
    }
    await sleep(10_000);
  }

  throw new Error(`Timed out waiting for ${label} tx ${txHash} to be accepted`);
}

async function waitForFinalResult(
  pollGenLayerWrite: (txHash: string, status?: TransactionStatus) => Promise<{ done: boolean; status?: string }>,
  getGenLayerJudgeResult: (contractAddress: string, hackathonId: string) => Promise<{
    finalized: boolean;
    winner_team_id?: string;
    winner_team_name?: string;
    final_score?: number;
    reasoning?: string;
    contractAddress: string;
  }>,
  contractAddress: string,
  hackathonId: string,
  finalizeTxHash: string,
) {
  let lastReceiptError: string | null = null;

  for (let attempt = 1; attempt <= 80; attempt += 1) {
    try {
      const result = await getGenLayerJudgeResult(contractAddress, hackathonId);
      console.log(`[Bradbury] result poll ${attempt}: finalized=${String(result.finalized)}`);
      if (result.finalized) {
        return result;
      }
    } catch (error) {
      console.log(`[Bradbury] result poll ${attempt} failed: ${formatError(error)}`);
    }

    try {
      const progress = await pollGenLayerWrite(finalizeTxHash, TransactionStatus.FINALIZED);
      console.log(`[Bradbury] finalize tx poll ${attempt}: ${progress.status ?? "unknown"}`);
      if (progress.done) {
        const result = await getGenLayerJudgeResult(contractAddress, hackathonId);
        if (result.finalized) return result;
      }
      lastReceiptError = null;
    } catch (error) {
      lastReceiptError = formatError(error);
      console.log(`[Bradbury] finalize tx poll ${attempt} failed: ${lastReceiptError}`);
    }

    await sleep(15_000);
  }

  throw new Error(
    lastReceiptError
      ? `Timed out waiting for finalized Bradbury result after receipt errors: ${lastReceiptError}`
      : `Timed out waiting for finalized Bradbury result for tx ${finalizeTxHash}`
  );
}

async function main() {
  loadEnvFile(path.join(appRoot, ".env.local"));
  loadEnvFile(path.join(appRoot, ".env"), { override: true });

  const configuredChain = (process.env.GENLAYER_CHAIN || "bradbury").replace(/^['"]|['"]$/g, "").trim().toLowerCase();
  requireEnv("GENLAYER_PRIVATE_KEY");

  if (![
    "bradbury",
    "testnet_bradbury",
    "testnet-bradbury",
  ].includes(configuredChain)) {
    throw new Error(`GENLAYER_CHAIN must target Bradbury for this verification script, got: ${configuredChain}`);
  }

  const mod = await import("@buildersclaw/shared/genlayer");
  const genlayerModule = (((mod as { default?: unknown }).default) ?? mod) as typeof import("@buildersclaw/shared/genlayer");
  const {
    isGenLayerAvailable,
    startGenLayerDeployment,
    pollGenLayerDeployment,
    startGenLayerSubmit,
    pollGenLayerWrite,
    startGenLayerFinalize,
    getGenLayerJudgeResult,
  } = genlayerModule;

  const available = await isGenLayerAvailable();
  if (!available) {
    throw new Error("GenLayer Bradbury testnet is not reachable with the current configuration");
  }

  const hackathonId = `bradbury-app-test-${Date.now()}`;
  const hackathonTitle = "Bradbury App GenLayer Verification";
  const hackathonBrief = "Choose the strongest production-ready developer tool from the submitted contenders.";
  const contenders = [
    {
      team_id: "team-alpha",
      team_name: "Alpha Team",
      repo_summary: "Excellent architecture, polished UX, strong tests, and complete deployment guidance.",
      gemini_score: 91,
    },
    {
      team_id: "team-beta",
      team_name: "Beta Team",
      repo_summary: "Useful implementation with good functionality but weaker testing depth and polish.",
      gemini_score: 84,
    },
  ];

  const deployment = await retryStart("deploy", () => startGenLayerDeployment(hackathonId, hackathonTitle, hackathonBrief));
  console.log(`[Bradbury] deploy tx: ${deployment.txHash}`);
  const contractAddress = await waitForDeployment(pollGenLayerDeployment, deployment.txHash);
  console.log(`[Bradbury] contract address: ${contractAddress}`);

  const submit = await retryStart("submit", () => startGenLayerSubmit(contractAddress, contenders));
  console.log(`[Bradbury] submit tx: ${submit.txHash}`);
  await waitForAcceptedWrite(pollGenLayerWrite, submit.txHash, "submit");

  const finalize = await retryStart("finalize", () => startGenLayerFinalize(contractAddress));
  console.log(`[Bradbury] finalize tx: ${finalize.txHash}`);
  const result = await waitForFinalResult(
    pollGenLayerWrite,
    getGenLayerJudgeResult,
    contractAddress,
    hackathonId,
    finalize.txHash,
  );

  if (!result.finalized) throw new Error("Expected finalized Bradbury result");
  if (!result.winner_team_id || !result.winner_team_name) {
    throw new Error("Bradbury verification did not return a winner");
  }

  console.log(JSON.stringify({
    chain: configuredChain,
    rpc: process.env.GENLAYER_RPC_URL || "https://rpc-bradbury.genlayer.com",
    deploy_tx_hash: deployment.txHash,
    submit_tx_hash: submit.txHash,
    finalize_tx_hash: finalize.txHash,
    ...result,
  }, null, 2));
  console.log("SUCCESS: Bradbury app-level GenLayer flow verified");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
