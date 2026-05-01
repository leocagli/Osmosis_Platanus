import fs from "fs";
import path from "path";
import { createAccount, createClient, chains } from "genlayer-js";
import type { TransactionHash } from "genlayer-js/types";

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

function statusNameOf(receipt: Record<string, unknown>): string | undefined {
  const raw =
    (receipt.status_name as string | undefined)
    ?? (receipt.statusName as string | undefined)
    ?? (typeof receipt.status === "string" ? receipt.status : undefined);
  return raw?.toUpperCase();
}

function stringifySafe(value: unknown) {
  return JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isReplaceConflict(error: unknown) {
  const message = formatError(error).toLowerCase();
  return message.includes("insufficient gas price to replace existing transaction")
    || message.includes("replacement transaction underpriced");
}

async function main() {
  loadEnvFile(path.join(appRoot, ".env.local"));
  loadEnvFile(path.join(appRoot, ".env"), { override: true });

  const chain = (process.env.GENLAYER_CHAIN || "bradbury").replace(/^['"]|['"]$/g, "").trim().toLowerCase();
  const rpc = process.env.GENLAYER_RPC_URL || "https://rpc-bradbury.genlayer.com";
  const pk = requireEnv("GENLAYER_PRIVATE_KEY");

  if (!["bradbury", "testnet_bradbury", "testnet-bradbury"].includes(chain)) {
    throw new Error(`GENLAYER_CHAIN must target Bradbury for this probe, got: ${chain}`);
  }

  const account = createAccount(pk as `0x${string}`);
  const client = createClient({
    chain: chains.testnetBradbury,
    account,
    endpoint: rpc,
  });

  const contractPath = path.join(appRoot, "genlayer/contracts/minimal_probe.py");
  const code = new Uint8Array(fs.readFileSync(contractPath));
  const expectedValue = `probe-${Date.now()}`;
  let txHash: `0x${string}` | null = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      txHash = await client.deployContract({ code, args: [expectedValue], leaderOnly: false });
      break;
    } catch (error) {
      if (!isReplaceConflict(error) || attempt === 5) throw error;
      console.log(`[Bradbury] probe deploy retry ${attempt}: ${formatError(error)}`);
      await sleep(30_000);
    }
  }

  if (!txHash) {
    throw new Error("Failed to submit Bradbury probe deployment");
  }

  let receipt: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const tx = await client.getTransaction({ hash: txHash as TransactionHash }) as Record<string, unknown>;
      const status = statusNameOf(tx);
      if (status === "CANCELED" || status === "UNDETERMINED") {
        throw new Error(`Probe deploy entered terminal status ${status}: ${stringifySafe(tx)}`);
      }
      if (status === "ACCEPTED" || status === "FINALIZED") {
        receipt = tx;
        break;
      }
    } catch (error) {
      console.log(`[Bradbury] probe poll ${attempt + 1} failed: ${formatError(error)}`);
    }
    await sleep(5000);
  }

  if (!receipt) {
    throw new Error(`Timed out waiting for minimal probe deploy: ${String(txHash)}`);
  }

  const executionResult = String(receipt.txExecutionResultName ?? "").toUpperCase();
  if (executionResult === "FINISHED_WITH_ERROR") {
    console.log(stringifySafe(receipt));
    throw new Error("Minimal probe deploy finished with error");
  }

  const contractAddress = (
    ((receipt.data as Record<string, unknown> | undefined)?.contract_address as string | undefined)
    ?? ((receipt.txDataDecoded as Record<string, unknown> | undefined)?.contractAddress as string | undefined)
    ?? (receipt.recipient as string | undefined)
    ?? (receipt.contractAddress as string | undefined)
  );

  if (!contractAddress) {
    console.log(stringifySafe(receipt));
    throw new Error("Minimal probe deploy did not return a contract address");
  }

  const value = await client.readContract({
    address: contractAddress as `0x${string}`,
    functionName: "get_value",
    args: [],
  });

  if (String(value) !== expectedValue) {
    throw new Error(`Unexpected minimal probe value: expected ${expectedValue}, got ${String(value)}`);
  }

  console.log(stringifySafe({
    chain,
    rpc,
    txHash: String(txHash),
    contractAddress,
    storedValue: String(value),
    status: receipt.statusName ?? receipt.status_name ?? receipt.status,
    txExecutionResult: receipt.txExecutionResultName ?? receipt.txExecutionResult,
  }));
  console.log("SUCCESS: Bradbury minimal probe verified");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
