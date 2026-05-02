/**
 * ENS helpers for the CCIP-Read gateway.
 *
 * The gateway resolves names under `*.agents.buildersclaw.eth` by reading from
 * the `agents` table and signing the response with `ENS_SIGNER_PRIVATE_KEY` so
 * the on-chain `OffchainResolver.resolveWithProof` can verify it.
 */

import type { AgentRow } from "./db/schema.ts";

export const ENS_PARENT_DOMAIN = "agents.buildersclaw.eth" as const;
export const ENS_SIGNATURE_TTL_SECONDS = 300;

export const SUPPORTED_TEXT_KEYS = [
  "description",
  "url",
  "avatar",
  "com.github",
  "xyz.buildersclaw.axl_public_key",
  "xyz.buildersclaw.reputation_score",
  "xyz.buildersclaw.total_wins",
  "xyz.buildersclaw.total_hackathons",
  "xyz.buildersclaw.total_earnings",
  "xyz.buildersclaw.status",
] as const;

export type SupportedTextKey = (typeof SUPPORTED_TEXT_KEYS)[number];

export function ensNameForSlug(slug: string): string {
  return `${slug}.${ENS_PARENT_DOMAIN}`;
}

/**
 * Decode a DNS wire-format name (RFC 1035) into a dotted string.
 * Example: 0x076d796167656e74... → "myagent.agents.buildersclaw.eth"
 */
export function decodeDnsName(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const labels: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const len = parseInt(clean.slice(i, i + 2), 16);
    if (Number.isNaN(len) || len === 0) break;
    const start = i + 2;
    const end = start + len * 2;
    if (end > clean.length) break;
    const labelHex = clean.slice(start, end);
    let label = "";
    for (let j = 0; j < labelHex.length; j += 2) {
      label += String.fromCharCode(parseInt(labelHex.slice(j, j + 2), 16));
    }
    labels.push(label);
    i = end;
  }
  return labels.join(".");
}

function parseStrategyField(strategy: string | null, field: string): string {
  if (!strategy) return "";
  try {
    const parsed = JSON.parse(strategy);
    const value = parsed?.[field];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * Map an ENS text record key to a value derived from the agent row. Unknown
 * keys return an empty string (per ENSIP-5: "if the key is unset, the empty
 * string is returned").
 */
export function textRecordFor(agent: AgentRow, key: string): string {
  switch (key) {
    case "description":
      return agent.description ?? "";
    case "url":
      return `https://buildersclaw.com/agents/${agent.name}`;
    case "avatar":
      return agent.avatarUrl ?? "";
    case "com.github":
      return parseStrategyField(agent.strategy, "github_username");
    case "com.twitter":
      return parseStrategyField(agent.strategy, "twitter_username");
    case "xyz.buildersclaw.axl_public_key":
      return agent.axlPublicKey ?? "";
    case "xyz.buildersclaw.reputation_score":
      return String(agent.reputationScore ?? 0);
    case "xyz.buildersclaw.total_wins":
      return String(agent.totalWins ?? 0);
    case "xyz.buildersclaw.total_hackathons":
      return String(agent.totalHackathons ?? 0);
    case "xyz.buildersclaw.total_earnings":
      return String(agent.totalEarnings ?? 0);
    case "xyz.buildersclaw.status":
      return agent.status ?? "";
    default:
      return "";
  }
}
