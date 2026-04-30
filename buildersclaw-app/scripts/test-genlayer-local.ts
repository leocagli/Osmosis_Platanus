import { spawn } from "child_process";
import path from "path";

const appRoot = process.cwd();
const genlayerRoot = path.join(appRoot, "genlayer");
const glsimPort = Number(process.env.GLSIM_PORT || "4002");
const glsimUrl = `http://127.0.0.1:${glsimPort}/api`;

// Local-only throwaway key for GLSim-backed validation.
const localPrivateKey =
  process.env.GENLAYER_LOCAL_PRIVATE_KEY
  || "0x1111111111111111111111111111111111111111111111111111111111111111";

const mockWinner = {
  winner_team_id: "team-alpha",
  winner_team_name: "Alpha Team",
  final_score: 92,
  reasoning: "Alpha best satisfies the brief with the strongest functionality, polish, and technical completeness.",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(method: string, params: unknown = []) {
  const response = await fetch(glsimUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  }

  return json.result;
}

async function waitForGlsim(proc: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`GLSim exited early with code ${proc.exitCode}`);
    }

    try {
      await rpc("eth_chainId");
      return;
    } catch {
      await sleep(250);
    }
  }

  throw new Error("Timed out waiting for GLSim to start");
}

async function main() {
  const env = { ...process.env };
  env.PYTHONPATH = env.PYTHONPATH
    ? `${genlayerRoot}${path.delimiter}${env.PYTHONPATH}`
    : genlayerRoot;

  const glsim = spawn("uv", ["run", "glsim", "--port", String(glsimPort), "--validators", "5"], {
    cwd: genlayerRoot,
    env,
    stdio: "ignore",
  });

  try {
    await waitForGlsim(glsim);

    await rpc("sim_installMocks", {
      llm_mocks: {
        ".*impartial judge.*": JSON.stringify(mockWinner),
      },
      strict: true,
    });

    process.env.GENLAYER_RPC_URL = glsimUrl;
    process.env.GENLAYER_CHAIN = "localnet";
    process.env.GENLAYER_PRIVATE_KEY = localPrivateKey;

    const mod = await import("../src/lib/genlayer");
    const genlayerModule = (((mod as { default?: unknown }).default) ?? mod) as typeof import("../src/lib/genlayer");
    const { isGenLayerAvailable, runGenLayerJudging } = genlayerModule;

    const available = await isGenLayerAvailable();
    if (!available) {
      throw new Error("src/lib/genlayer.ts did not consider local GLSim available");
    }

    const result = await runGenLayerJudging(
      `local-app-test-${Date.now()}`,
      "Local App GenLayer Validation",
      "Choose the strongest production-ready developer tool from the top contenders.",
      [
        {
          team_id: "team-alpha",
          team_name: "Alpha Team",
          repo_summary: "Excellent architecture, polished UX, strong tests, and complete deployment guidance.",
          gemini_score: 91,
        },
        {
          team_id: "team-beta",
          team_name: "Beta Team",
          repo_summary: "Good implementation with useful functionality but weaker testing depth and product polish.",
          gemini_score: 84,
        },
        {
          team_id: "team-gamma",
          team_name: "Gamma Team",
          repo_summary: "Interesting concept with partial execution and several missing production details.",
          gemini_score: 73,
        },
      ],
    );

    if (!result.finalized) throw new Error("Expected finalized result from local GenLayer run");
    if (result.winner_team_id !== mockWinner.winner_team_id) {
      throw new Error(`Expected winner ${mockWinner.winner_team_id}, got ${result.winner_team_id ?? "<missing>"}`);
    }
    if (!result.contractAddress || !result.deploy_tx_hash || !result.submit_tx_hash || !result.finalize_tx_hash) {
      throw new Error("Local GenLayer run did not return contract address and tx hashes");
    }

    console.log(JSON.stringify(result, null, 2));
    console.log("SUCCESS: local app-level GenLayer flow verified");
  } finally {
    glsim.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => glsim.once("exit", resolve)),
      sleep(5_000),
    ]);
    if (glsim.exitCode === null) {
      glsim.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
