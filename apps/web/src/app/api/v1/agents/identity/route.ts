import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { error, success, unauthorized } from "@buildersclaw/shared/responses";
import {
  buildIdentityLinkMessage,
  fetchRegistrationFile,
  getAgentIdentity,
  getErc8004Config,
  readIdentityRegistryAgent,
  syncAgentIdentity,
  syncAgentReputation,
  verifyIdentityLinkSignature,
} from "@buildersclaw/shared/erc8004";

function dbErrorCode(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string"
    ? err.code
    : null;
}

async function getAgentById(agentId: string) {
  const [agent] = await getDb()
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      display_name: schema.agents.displayName,
      description: schema.agents.description,
      avatar_url: schema.agents.avatarUrl,
      wallet_address: schema.agents.walletAddress,
      api_key_hash: schema.agents.apiKeyHash,
      model: schema.agents.model,
      personality: schema.agents.personality,
      strategy: schema.agents.strategy,
      total_earnings: schema.agents.totalEarnings,
      total_hackathons: schema.agents.totalHackathons,
      total_wins: schema.agents.totalWins,
      reputation_score: schema.agents.reputationScore,
      identity_registry: schema.agents.identityRegistry,
      identity_agent_id: schema.agents.identityAgentId,
      identity_chain_id: schema.agents.identityChainId,
      identity_agent_uri: schema.agents.identityAgentUri,
      identity_wallet: schema.agents.identityWallet,
      identity_owner_wallet: schema.agents.identityOwnerWallet,
      identity_source: schema.agents.identitySource,
      identity_link_status: schema.agents.identityLinkStatus,
      identity_verified_at: schema.agents.identityVerifiedAt,
      marketplace_reputation_score: schema.agents.marketplaceReputationScore,
      marketplace_completed_roles: schema.agents.marketplaceCompletedRoles,
      marketplace_successful_roles: schema.agents.marketplaceSuccessfulRoles,
      marketplace_failed_roles: schema.agents.marketplaceFailedRoles,
      marketplace_review_approvals: schema.agents.marketplaceReviewApprovals,
      marketplace_no_show_count: schema.agents.marketplaceNoShowCount,
      status: schema.agents.status,
      created_at: schema.agents.createdAt,
      last_active: schema.agents.lastActive,
    })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  return agent;
}

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
    getDb()
      .select({
        agent_id: schema.agentIdentitySnapshots.agentId,
        identity_registry: schema.agentIdentitySnapshots.identityRegistry,
        identity_agent_id: schema.agentIdentitySnapshots.identityAgentId,
        identity_chain_id: schema.agentIdentitySnapshots.identityChainId,
        identity_agent_uri: schema.agentIdentitySnapshots.identityAgentUri,
        identity_wallet: schema.agentIdentitySnapshots.identityWallet,
        identity_owner_wallet: schema.agentIdentitySnapshots.identityOwnerWallet,
        registration_valid: schema.agentIdentitySnapshots.registrationValid,
        last_synced_at: schema.agentIdentitySnapshots.lastSyncedAt,
        payload: schema.agentIdentitySnapshots.payload,
      })
      .from(schema.agentIdentitySnapshots)
      .where(eq(schema.agentIdentitySnapshots.agentId, agent.id))
      .limit(1),
    getDb()
      .select({
        agent_id: schema.agentReputationSnapshots.agentId,
        identity_registry: schema.agentReputationSnapshots.identityRegistry,
        identity_agent_id: schema.agentReputationSnapshots.identityAgentId,
        trusted_client_count: schema.agentReputationSnapshots.trustedClientCount,
        trusted_feedback_count: schema.agentReputationSnapshots.trustedFeedbackCount,
        trusted_summary_value: schema.agentReputationSnapshots.trustedSummaryValue,
        trusted_summary_decimals: schema.agentReputationSnapshots.trustedSummaryDecimals,
        raw_client_count: schema.agentReputationSnapshots.rawClientCount,
        raw_feedback_count: schema.agentReputationSnapshots.rawFeedbackCount,
        last_synced_at: schema.agentReputationSnapshots.lastSyncedAt,
        payload: schema.agentReputationSnapshots.payload,
      })
      .from(schema.agentReputationSnapshots)
      .where(eq(schema.agentReputationSnapshots.agentId, agent.id))
      .limit(1),
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
    identity_snapshot: identitySnapshot[0] || null,
    reputation_snapshot: reputationSnapshot[0] || null,
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

    const refreshed = await getAgentById(agent.id);

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

  try {
    await getDb()
      .update(schema.agents)
      .set({
        identityRegistry: config.agentRegistry,
        identityAgentId: identityAgentId,
        identityChainId: config.chainId,
        identityAgentUri: onChain.agentUri || null,
        identityWallet: onChain.agentWallet,
        identityOwnerWallet: onChain.ownerWallet,
        identitySource: source === "buildersclaw" ? "buildersclaw" : "external",
        identityLinkStatus: "linked",
        identityVerifiedAt: now,
      })
      .where(eq(schema.agents.id, agent.id));
  } catch (err) {
    const code = dbErrorCode(err);
    const message = code === "23505"
      ? "That ERC-8004 identity is already linked to another BuildersClaw agent"
      : "Failed to link ERC-8004 identity";
    return error(message, code === "23505" ? 409 : 500);
  }

  try {
    await getDb()
      .insert(schema.agentIdentitySnapshots)
      .values({
        agentId: agent.id,
        identityRegistry: config.agentRegistry,
        identityAgentId,
        identityChainId: config.chainId,
        identityAgentUri: onChain.agentUri || null,
        identityWallet: onChain.agentWallet,
        identityOwnerWallet: onChain.ownerWallet,
        registrationValid: !!registration,
        lastSyncedAt: now,
        payload: {
          registration,
          owner_wallet: onChain.ownerWallet,
          agent_wallet: onChain.agentWallet,
          agent_uri: onChain.agentUri || null,
        },
      })
      .onConflictDoUpdate({
        target: schema.agentIdentitySnapshots.agentId,
        set: {
          identityRegistry: config.agentRegistry,
          identityAgentId,
          identityChainId: config.chainId,
          identityAgentUri: onChain.agentUri || null,
          identityWallet: onChain.agentWallet,
          identityOwnerWallet: onChain.ownerWallet,
          registrationValid: !!registration,
          lastSyncedAt: now,
          payload: {
            registration,
            owner_wallet: onChain.ownerWallet,
            agent_wallet: onChain.agentWallet,
            agent_uri: onChain.agentUri || null,
          },
        },
      });
  } catch {
    // Match the previous Supabase call: snapshot write errors were not surfaced.
  }

  const refreshed = await getAgentById(agent.id);
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
