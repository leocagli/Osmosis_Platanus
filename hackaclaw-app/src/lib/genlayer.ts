/**
 * GenLayer integration for on-chain hackathon judging.
 *
 * After Gemini pre-scores all submissions, the top 3 contenders
 * are sent to a GenLayer Intelligent Contract where 5 independent
 * validators use LLM consensus to pick the winner impartially.
 *
 * The result is stored on-chain and verifiable by anyone.
 */

// GenLayer JSON-RPC client — no SDK dependency needed, pure fetch
const GENLAYER_RPC = process.env.GENLAYER_RPC_URL || "http://127.0.0.1:4000/api";
const GENLAYER_PRIVATE_KEY = process.env.GENLAYER_PRIVATE_KEY || "";

interface GenLayerContender {
  team_id: string;
  team_name: string;
  repo_url: string;
  repo_summary: string;
  gemini_score: number;
  gemini_feedback: string;
}

interface GenLayerJudgeResult {
  finalized: boolean;
  hackathon_id: string;
  winner_team_id?: string;
  winner_team_name?: string;
  final_score?: number;
  reasoning?: string;
}

// ─── JSON-RPC helper ───

async function genlayerRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const resp = await fetch(GENLAYER_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    }),
  });

  const data = await resp.json();
  if (data.error) {
    throw new Error(`GenLayer RPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

// ─── Account management ───

let _cachedAccount: { address: string; privateKey: string } | null = null;

async function getOrCreateAccount(): Promise<{ address: string; privateKey: string }> {
  if (_cachedAccount) return _cachedAccount;

  if (GENLAYER_PRIVATE_KEY) {
    // Derive address from private key using eth_account logic
    // For now, create a new account via RPC and use that
  }

  // Create ephemeral account via RPC
  const result = await genlayerRpc("eth_accounts") as string[];
  if (result && result.length > 0) {
    _cachedAccount = { address: result[0], privateKey: GENLAYER_PRIVATE_KEY || "ephemeral" };
    return _cachedAccount;
  }

  throw new Error("GenLayer: could not get or create account");
}

// ─── Public API ───

/**
 * Deploy a new HackathonJudge contract for a hackathon.
 * Returns the contract address.
 */
export async function deployJudgeContract(
  hackathonId: string,
  title: string,
  brief: string,
): Promise<string> {
  // Read contract source
  const contractCode = await getContractCode();
  const account = await getOrCreateAccount();

  const txHash = await genlayerRpc("gen_sendTransaction", [{
    type: "deploy",
    from: account.address,
    code: Buffer.from(contractCode).toString("base64"),
    args: [hackathonId, title, brief],
  }]) as string;

  // Wait for receipt
  const receipt = await waitForReceipt(txHash);
  const data = receipt?.data as Record<string, unknown> | undefined;
  const contractAddress = data?.contract_address as string | undefined;

  if (!contractAddress) {
    throw new Error(`GenLayer deploy failed. Receipt: ${JSON.stringify(receipt)}`);
  }

  console.log(`GenLayer: deployed HackathonJudge at ${contractAddress} for ${hackathonId}`);
  return contractAddress;
}

/**
 * Submit the top contenders to an existing judge contract.
 * Called after Gemini pre-scoring filters down to top 3.
 */
export async function submitContenders(
  contractAddress: string,
  contenders: GenLayerContender[],
): Promise<void> {
  const account = await getOrCreateAccount();

  const txHash = await genlayerRpc("gen_sendTransaction", [{
    type: "call",
    from: account.address,
    to: contractAddress,
    method: "submit_contenders",
    args: [JSON.stringify(contenders)],
  }]) as string;

  const receipt = await waitForReceipt(txHash);
  console.log(`GenLayer: submitted ${contenders.length} contenders. Status: ${receipt?.status}`);
}

/**
 * Trigger finalization — validators run LLM consensus to pick winner.
 * This is the on-chain impartial judging step.
 */
export async function finalizeJudging(contractAddress: string): Promise<GenLayerJudgeResult> {
  const account = await getOrCreateAccount();

  const txHash = await genlayerRpc("gen_sendTransaction", [{
    type: "call",
    from: account.address,
    to: contractAddress,
    method: "finalize",
    args: [],
  }]) as string;

  const receipt = await waitForReceipt(txHash);
  console.log(`GenLayer: finalize tx status: ${receipt?.status}`);

  // Read the result
  return readJudgeResult(contractAddress);
}

/**
 * Read the current judge result from the contract (view call, free).
 */
export async function readJudgeResult(contractAddress: string): Promise<GenLayerJudgeResult> {
  const account = await getOrCreateAccount();

  const result = await genlayerRpc("gen_call", [{
    from: account.address,
    to: contractAddress,
    method: "get_result",
    args: [],
  }]) as GenLayerJudgeResult;

  return result;
}

/**
 * Full pipeline: deploy → submit contenders → finalize → read result.
 * This is the main entry point called from judge.ts after Gemini scoring.
 */
export async function runGenLayerJudging(
  hackathonId: string,
  hackathonTitle: string,
  hackathonBrief: string,
  topContenders: GenLayerContender[],
): Promise<GenLayerJudgeResult> {
  console.log(`GenLayer: starting on-chain judging for "${hackathonTitle}" with ${topContenders.length} contenders`);

  // 1. Deploy a fresh contract for this hackathon
  const contractAddress = await deployJudgeContract(hackathonId, hackathonTitle, hackathonBrief);

  // 2. Submit the top contenders
  await submitContenders(contractAddress, topContenders);

  // 3. Finalize — triggers LLM consensus among validators
  const result = await finalizeJudging(contractAddress);

  console.log(`GenLayer: judging complete. Winner: ${result.winner_team_name || "none"} (${result.winner_team_id})`);

  return result;
}

// ─── Helpers ───

async function waitForReceipt(txHash: string, maxRetries = 60): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const receipt = await genlayerRpc("gen_getTransactionReceipt", [txHash]) as Record<string, unknown> | null;
      if (receipt && receipt.status) {
        return receipt;
      }
    } catch {
      // Receipt not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`GenLayer: tx ${txHash} did not confirm after ${maxRetries * 2}s`);
}

async function getContractCode(): Promise<string> {
  // Try reading from the genlayer-judge directory (monorepo layout)
  const paths = [
    "../genlayer-judge/contracts/hackathon_judge.py",
    "./genlayer-judge/contracts/hackathon_judge.py",
    "../../genlayer-judge/contracts/hackathon_judge.py",
  ];

  for (const p of paths) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const resolved = path.resolve(process.cwd(), p);
      if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved, "utf-8");
      }
    } catch {
      continue;
    }
  }

  // Fallback: embedded minimal contract path
  throw new Error("GenLayer: hackathon_judge.py not found. Ensure genlayer-judge/ is in the project root.");
}

/**
 * Check if GenLayer is configured and reachable.
 */
export async function isGenLayerAvailable(): Promise<boolean> {
  try {
    const result = await genlayerRpc("eth_chainId");
    return !!result;
  } catch {
    return false;
  }
}

export type { GenLayerContender, GenLayerJudgeResult };
