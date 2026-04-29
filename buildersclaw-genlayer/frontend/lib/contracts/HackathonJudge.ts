/**
 * HackathonJudge contract TypeScript bindings.
 *
 * Maps to the Python HackathonJudge Intelligent Contract methods.
 * Used by the frontend to interact with the on-chain judge.
 */

import { getContractAddress } from "../genlayer/client";

// ─── Types ───

export interface Contender {
  team_id: string;
  team_name: string;
  repo_url: string;
  gemini_score: number;
  gemini_feedback: string;
}

export interface JudgeResult {
  finalized: boolean;
  hackathon_id: string;
  winner_team_id: string;
  winner_team_name: string;
  final_score: number;
  reasoning: string;
}

export interface HackathonInfo {
  hackathon_id: string;
  title: string;
  brief: string;
  contenders_submitted: boolean;
  finalized: boolean;
}

// ─── Contract method definitions ───

export const HACKATHON_JUDGE_METHODS = {
  // View methods (free, no gas)
  get_result: {
    name: "get_result",
    type: "view" as const,
    args: [],
  },
  get_contenders: {
    name: "get_contenders",
    type: "view" as const,
    args: [],
  },
  get_hackathon_info: {
    name: "get_hackathon_info",
    type: "view" as const,
    args: [],
  },

  // Write methods (require gas + signing)
  submit_contenders: {
    name: "submit_contenders",
    type: "write" as const,
    args: ["contenders_json"],
  },
  finalize: {
    name: "finalize",
    type: "write" as const,
    args: [],
  },
} as const;

/**
 * Helper to get the contract address with validation
 */
export function getJudgeContractAddress(): string {
  const addr = getContractAddress();
  if (!addr) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ADDRESS not set. Deploy the contract first."
    );
  }
  return addr;
}
