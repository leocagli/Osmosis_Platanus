import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { error, success, unauthorized } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import {
  buildIdentityLinkMessage,
  fetchRegistrationFile,
  getAgentIdentity,
  getErc8004Config,
  readIdentityRegistryAgent,
  syncAgentIdentity,
  syncAgentReputation,
  verifyIdentityLinkSignature,
} from "@/lib/erc8004";

/**
 * GET /api/v1/agents/identity
 * Returns the authenticated agent's linked ERC-8004 identity and cached snapshots.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const config = getErc8004Config();
  const messageIdentityAgentId = req.nextUrl.searchParams.get("identity_agent_id");
  const messageIssuedAt = req.nextUrl.searchParams.get("issued_at");

  const [identitySnapshot, reputationSnapshot] = await Promise.all([
    supabaseAdmin.from("agent_identity_snapshots").select("*").eq("agent_id", agent.id).maybeSingle(),
    supabaseAdmin.from("agent_reputation_snapshots").select("*").eq("agent_id", agent.id).maybeSingle(),
  ]);

  return success({
    config: (() => {
      if (!config) return null;
      return {
        chain_id: config.chainId,
        identity_registry: config.identityRegistry,
        reputation_registry: config.reputationRegistry,
        agent_registry: config.agentRegistry,
      };
    })(),
    identity: getAgentIdentity(agent),
    ...(config && messageIdentityAgentId && messageIssuedAt
      ? {
        link_message: buildIdentityLinkMessage({
          appAgentId: agent.id,
          identityAgentId: messageIdentityAgentId,
          identityRegistry: config.identityRegistry,
          chainId: config.chainId,
          issuedAt: messageIssuedAt,
        }),
      }
      : {}),
    identity_snapshot: identitySnapshot.data || null,
    reputation_snapshot: reputationSnapshot.data || null,
  });
}

/**
 * POST /api/v1/agents/identity
 * Actions:
 * - link: link a canonical ERC-8004 identity to the authenticated BuildersClaw agent
 * - sync: refresh linked identity + reputation snapshots from chain
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const config = getErc8004Config();
  if (!config) {
    return error("ERC-8004 is not configured on this deployment", 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action.trim() : "link";

  if (action === "sync") {
    if (!agent.identity_agent_id) {
      return error("This agent has no linked ERC-8004 identity", 400);
    }

    const identity = await syncAgentIdentity(agent);
    const reputation = await syncAgentReputation(agent);

    const { data: refreshed } = await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single();

    return success({
      identity: getAgentIdentity(refreshed || agent),
      identity_snapshot: identity,
      reputation_snapshot: reputation,
    });
  }

  const identityAgentId = typeof body.identity_agent_id === "string" ? body.identity_agent_id.trim() : "";
  const issuedAt = typeof body.issued_at === "string" ? body.issued_at.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  const source = typeof body.identity_source === "string" ? body.identity_source.trim() : "external";

  if (!identityAgentId) return error("identity_agent_id is required", 400);
  if (!/^\d+$/.test(identityAgentId)) return error("identity_agent_id must be a decimal string", 400);
  if (!issuedAt) return error("issued_at is required", 400);
  if (!signature.startsWith("0x")) return error("signature must be a hex string", 400);

  let onChain;
  try {
    onChain = await readIdentityRegistryAgent(identityAgentId);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Failed to read identity registry", 400);
  }

  try {
    await verifyIdentityLinkSignature({
      appAgentId: agent.id,
      identityAgentId,
      issuedAt,
      signature: signature as `0x${string}`,
      allowedWallets: [onChain.ownerWallet, onChain.agentWallet || ""],
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Identity signature verification failed", 400);
  }

  const registration = onChain.agentUri ? await fetchRegistrationFile(onChain.agentUri) : null;
  const now = new Date().toISOString();

  const { error: updateErr } = await supabaseAdmin
    .from("agents")
    .update({
      identity_registry: config.agentRegistry,
      identity_agent_id: identityAgentId,
      identity_chain_id: config.chainId,
      identity_agent_uri: onChain.agentUri || null,
      identity_wallet: onChain.agentWallet,
      identity_owner_wallet: onChain.ownerWallet,
      identity_source: source === "buildersclaw" ? "buildersclaw" : "external",
      identity_link_status: "linked",
      identity_verified_at: now,
    })
    .eq("id", agent.id);

  if (updateErr) {
    const message = updateErr.code === "23505"
      ? "That ERC-8004 identity is already linked to another BuildersClaw agent"
      : "Failed to link ERC-8004 identity";
    return error(message, updateErr.code === "23505" ? 409 : 500);
  }

  await supabaseAdmin.from("agent_identity_snapshots").upsert({
    agent_id: agent.id,
    identity_registry: config.agentRegistry,
    identity_agent_id: identityAgentId,
    identity_chain_id: config.chainId,
    identity_agent_uri: onChain.agentUri || null,
    identity_wallet: onChain.agentWallet,
    identity_owner_wallet: onChain.ownerWallet,
    registration_valid: !!registration,
    last_synced_at: now,
    payload: {
      registration,
      owner_wallet: onChain.ownerWallet,
      agent_wallet: onChain.agentWallet,
      agent_uri: onChain.agentUri || null,
    },
  }, { onConflict: "agent_id" });

  const { data: refreshed } = await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single();
  const reputation = await syncAgentReputation(refreshed || agent);

  return success({
    linked: true,
    identity: getAgentIdentity(refreshed || agent),
    registration_valid: !!registration,
    registration,
    reputation_snapshot: reputation,
    how_to_sign: {
      message_format: [
        "BuildersClaw ERC-8004 identity link",
        `app_agent_id:${agent.id}`,
        `identity_agent_id:${identityAgentId}`,
        `identity_registry:${config.identityRegistry}`,
        `chain_id:${config.chainId}`,
        `issued_at:${issuedAt}`,
      ].join("\n"),
    },
  });
}
