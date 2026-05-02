import { getAddress, isAddress, parseAbi, verifyMessage, type Address } from "viem";
import { eq } from "drizzle-orm";
import type { Agent } from "./types";
import { getConfiguredChainId, getPublicChainClient } from "./chain";
import { getDb } from "./db";
import { agentIdentitySnapshots, agentReputationSnapshots, agents, trustedReputationSources } from "./db/schema";

const identityRegistryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

const reputationRegistryAbi = parseAbi([
  "function getClients(uint256 agentId) view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
]);

export type Erc8004Service = {
  name: string;
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
};

export type Erc8004Registration = {
  type: string;
  name: string;
  description: string;
  image: string;
  services: Erc8004Service[];
  x402Support: boolean;
  active: boolean;
  registrations: Array<{ agentId: number | string; agentRegistry: string }>;
  supportedTrust?: string[];
};

export type Erc8004Config = {
  chainId: number;
  identityRegistry: Address;
  reputationRegistry: Address | null;
  agentRegistry: string;
};

export type LinkedIdentitySummary = {
  linked: boolean;
  agent_registry: string | null;
  agent_id: string | null;
  chain_id: number | null;
  agent_uri: string | null;
  owner_wallet: string | null;
  wallet: string | null;
  source: string | null;
  link_status: string | null;
  verified_at: string | null;
};

export function getErc8004Config(): Erc8004Config | null {
  const identityRegistryRaw = process.env.IDENTITY_REGISTRY;
  if (!identityRegistryRaw || !isAddress(identityRegistryRaw)) return null;

  const reputationRegistryRaw = process.env.REPUTATION_REGISTRY;
  const chainId = getConfiguredChainId();
  const identityRegistry = getAddress(identityRegistryRaw);
  const reputationRegistry = reputationRegistryRaw && isAddress(reputationRegistryRaw)
    ? getAddress(reputationRegistryRaw)
    : null;

  return {
    chainId,
    identityRegistry,
    reputationRegistry,
    agentRegistry: formatAgentRegistry(chainId, identityRegistry),
  };
}

export function formatAgentRegistry(chainId: number, identityRegistry: string) {
  return `eip155:${chainId}:${getAddress(identityRegistry)}`;
}

export function getAgentIdentity(agent: Partial<Agent>): LinkedIdentitySummary {
  return {
    linked: !!agent.identity_registry && !!agent.identity_agent_id,
    agent_registry: typeof agent.identity_registry === "string" ? agent.identity_registry : null,
    agent_id: typeof agent.identity_agent_id === "string" ? agent.identity_agent_id : null,
    chain_id: typeof agent.identity_chain_id === "number" ? agent.identity_chain_id : null,
    agent_uri: typeof agent.identity_agent_uri === "string" ? agent.identity_agent_uri : null,
    owner_wallet: typeof agent.identity_owner_wallet === "string" ? agent.identity_owner_wallet : null,
    wallet: typeof agent.identity_wallet === "string" ? agent.identity_wallet : null,
    source: typeof agent.identity_source === "string" ? agent.identity_source : null,
    link_status: typeof agent.identity_link_status === "string" ? agent.identity_link_status : null,
    verified_at: typeof agent.identity_verified_at === "string" ? agent.identity_verified_at : null,
  };
}

export function getMarketplaceReputationScore(agent: Partial<Agent>) {
  const marketplaceScore = typeof agent.marketplace_reputation_score === "number"
    ? agent.marketplace_reputation_score
    : 0;
  const legacyScore = typeof agent.reputation_score === "number" ? agent.reputation_score : 0;
  return marketplaceScore > 0 ? marketplaceScore : legacyScore;
}

export function buildIdentityLinkMessage(params: {
  appAgentId: string;
  identityAgentId: string;
  identityRegistry: string;
  chainId: number;
  issuedAt: string;
}) {
  return [
    "BuildersClaw ERC-8004 identity link",
    `app_agent_id:${params.appAgentId}`,
    `identity_agent_id:${params.identityAgentId}`,
    `identity_registry:${getAddress(params.identityRegistry)}`,
    `chain_id:${params.chainId}`,
    `issued_at:${params.issuedAt}`,
  ].join("\n");
}

export async function readIdentityRegistryAgent(identityAgentId: string) {
  const config = getErc8004Config();
  if (!config) throw new Error("ERC-8004 identity registry is not configured");

  const publicClient = getPublicChainClient();
  const agentId = BigInt(identityAgentId);

  const [ownerWallet, agentUri, agentWallet] = await Promise.all([
    publicClient.readContract({
      address: config.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    }),
    publicClient.readContract({
      address: config.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "tokenURI",
      args: [agentId],
    }).catch(() => ""),
    publicClient.readContract({
      address: config.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    }).catch(() => "0x0000000000000000000000000000000000000000"),
  ]);

  return {
    identityAgentId,
    identityRegistry: config.identityRegistry,
    chainId: config.chainId,
    agentRegistry: config.agentRegistry,
    ownerWallet,
    agentUri: agentUri || "",
    agentWallet: agentWallet === "0x0000000000000000000000000000000000000000" ? null : agentWallet,
  };
}

export async function verifyIdentityLinkSignature(params: {
  appAgentId: string;
  identityAgentId: string;
  issuedAt: string;
  signature: `0x${string}`;
  allowedWallets: string[];
}) {
  const config = getErc8004Config();
  if (!config) throw new Error("ERC-8004 identity registry is not configured");

  const issuedAtMs = Date.parse(params.issuedAt);
  if (!Number.isFinite(issuedAtMs)) throw new Error("issued_at must be a valid ISO timestamp");

  const skewMs = Math.abs(Date.now() - issuedAtMs);
  if (skewMs > 5 * 60 * 1000) {
    throw new Error("issued_at is too old or too far in the future");
  }

  const message = buildIdentityLinkMessage({
    appAgentId: params.appAgentId,
    identityAgentId: params.identityAgentId,
    identityRegistry: config.identityRegistry,
    chainId: config.chainId,
    issuedAt: params.issuedAt,
  });

  for (const wallet of params.allowedWallets) {
    if (!wallet || !isAddress(wallet)) continue;
    const valid = await verifyMessage({
      address: getAddress(wallet),
      message,
      signature: params.signature,
    });
    if (valid) return { message, signer: getAddress(wallet) };
  }

  throw new Error("Signature must be produced by the identity owner wallet or verified agent wallet");
}

export async function fetchRegistrationFile(uri: string): Promise<Erc8004Registration | null> {
  if (!uri) return null;

  if (uri.startsWith("data:application/json;base64,")) {
    const payload = uri.slice("data:application/json;base64,".length);
    try {
      const decoded = Buffer.from(payload, "base64").toString("utf8");
      return validateRegistrationJson(JSON.parse(decoded));
    } catch {
      return null;
    }
  }

  let fetchUrl = uri;
  if (uri.startsWith("ipfs://")) {
    fetchUrl = `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }

  if (!fetchUrl.startsWith("https://") && !fetchUrl.startsWith("http://")) {
    return null;
  }

  const response = await fetch(fetchUrl, {
    headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.5" },
    cache: "no-store",
  }).catch(() => null);

  if (!response || !response.ok) return null;
  const json = await response.json().catch(() => null);
  if (!json) return null;
  return validateRegistrationJson(json);
}

export function validateRegistrationJson(json: unknown): Erc8004Registration | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  if (
    typeof value.type !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.image !== "string" ||
    !Array.isArray(value.services) ||
    typeof value.x402Support !== "boolean" ||
    typeof value.active !== "boolean" ||
    !Array.isArray(value.registrations)
  ) {
    return null;
  }

  const services = value.services
    .filter((service): service is Record<string, unknown> => !!service && typeof service === "object")
    .filter((service) => typeof service.name === "string" && typeof service.endpoint === "string")
    .map((service) => ({
      name: service.name as string,
      endpoint: service.endpoint as string,
      ...(typeof service.version === "string" ? { version: service.version } : {}),
      ...(Array.isArray(service.skills) ? { skills: service.skills.filter((item): item is string => typeof item === "string") } : {}),
      ...(Array.isArray(service.domains) ? { domains: service.domains.filter((item): item is string => typeof item === "string") } : {}),
    }));

  const registrations = value.registrations
    .filter((registration): registration is Record<string, unknown> => !!registration && typeof registration === "object")
    .filter((registration) => (typeof registration.agentId === "number" || typeof registration.agentId === "string") && typeof registration.agentRegistry === "string")
    .map((registration) => ({
      agentId: registration.agentId as number | string,
      agentRegistry: registration.agentRegistry as string,
    }));

  if (services.length === 0 || registrations.length === 0) return null;

  return {
    type: value.type,
    name: value.name,
    description: value.description,
    image: value.image,
    services,
    x402Support: value.x402Support,
    active: value.active,
    registrations,
    ...(Array.isArray(value.supportedTrust)
      ? { supportedTrust: value.supportedTrust.filter((item): item is string => typeof item === "string") }
      : {}),
  };
}

export async function syncAgentIdentity(agent: Partial<Agent>) {
  const config = getErc8004Config();
  const identityAgentId = typeof agent.identity_agent_id === "string" ? agent.identity_agent_id : null;
  if (!config || !identityAgentId || !agent.id) return null;

  const onChain = await readIdentityRegistryAgent(identityAgentId);
  const registration = onChain.agentUri ? await fetchRegistrationFile(onChain.agentUri) : null;
  const now = new Date().toISOString();

  const updates = {
    identity_registry: config.agentRegistry,
    identity_chain_id: config.chainId,
    identity_agent_uri: onChain.agentUri || null,
    identity_wallet: onChain.agentWallet,
    identity_owner_wallet: onChain.ownerWallet,
    identity_link_status: "linked",
    identity_verified_at: now,
  };

  await getDb().transaction(async (tx) => {
    await tx
      .update(agents)
      .set({
        identityRegistry: config.agentRegistry,
        identityChainId: config.chainId,
        identityAgentUri: onChain.agentUri || null,
        identityWallet: onChain.agentWallet,
        identityOwnerWallet: onChain.ownerWallet,
        identityLinkStatus: "linked",
        identityVerifiedAt: now,
      })
      .where(eq(agents.id, agent.id!));

    await tx
      .insert(agentIdentitySnapshots)
      .values({
        agentId: agent.id!,
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
        target: agentIdentitySnapshots.agentId,
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
  });

  return {
    ...updates,
    registration,
  };
}

export async function syncAgentReputation(agent: Partial<Agent>) {
  const config = getErc8004Config();
  const identityAgentId = typeof agent.identity_agent_id === "string" ? agent.identity_agent_id : null;
  if (!config || !config.reputationRegistry || !identityAgentId || !agent.id) return null;

  const publicClient = getPublicChainClient();
  const agentId = BigInt(identityAgentId);
  const now = new Date().toISOString();

  const trustedSources = await getDb()
    .select({ walletAddress: trustedReputationSources.walletAddress })
    .from(trustedReputationSources)
    .where(eq(trustedReputationSources.active, true));

  const trustedWallets = trustedSources
    .map((row) => row.walletAddress)
    .filter((wallet): wallet is string => !!wallet && isAddress(wallet))
    .map((wallet) => getAddress(wallet));

  const [clients, allFeedback] = await Promise.all([
    publicClient.readContract({
      address: config.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getClients",
      args: [agentId],
    }).catch(() => [] as Address[]),
    publicClient.readContract({
      address: config.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "readAllFeedback",
      args: [agentId, [], "", "", false],
    }).catch(() => [[], [], [], [], [], [], []] as [Address[], bigint[], bigint[], number[], string[], string[], boolean[]]),
  ]);

  let trustedSummaryCount = 0;
  let trustedSummaryValue: string | null = null;
  let trustedSummaryDecimals: number | null = null;

  if (trustedWallets.length > 0) {
    const summary = await publicClient.readContract({
      address: config.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [agentId, trustedWallets, "", ""],
    }).catch(() => null);

    if (summary) {
      trustedSummaryCount = Number(summary[0]);
      trustedSummaryValue = summary[1].toString();
      trustedSummaryDecimals = Number(summary[2]);
    }
  }

  const rawFeedbackCount = Array.isArray(allFeedback?.[0]) ? allFeedback[0].length : 0;

  await getDb()
    .insert(agentReputationSnapshots)
    .values({
      agentId: agent.id,
      identityRegistry: config.agentRegistry,
      identityAgentId,
      trustedClientCount: trustedWallets.length,
      trustedFeedbackCount: trustedSummaryCount,
      trustedSummaryValue,
      trustedSummaryDecimals,
      rawClientCount: clients.length,
      rawFeedbackCount,
      lastSyncedAt: now,
      payload: {
        trusted_wallets: trustedWallets,
        raw_clients: clients,
        raw_feedback_count: rawFeedbackCount,
        trusted_summary_count: trustedSummaryCount,
        trusted_summary_value: trustedSummaryValue,
        trusted_summary_decimals: trustedSummaryDecimals,
      },
    })
    .onConflictDoUpdate({
      target: agentReputationSnapshots.agentId,
      set: {
        identityRegistry: config.agentRegistry,
        identityAgentId,
        trustedClientCount: trustedWallets.length,
        trustedFeedbackCount: trustedSummaryCount,
        trustedSummaryValue,
        trustedSummaryDecimals,
        rawClientCount: clients.length,
        rawFeedbackCount,
        lastSyncedAt: now,
        payload: {
          trusted_wallets: trustedWallets,
          raw_clients: clients,
          raw_feedback_count: rawFeedbackCount,
          trusted_summary_count: trustedSummaryCount,
          trusted_summary_value: trustedSummaryValue,
          trusted_summary_decimals: trustedSummaryDecimals,
        },
      },
    });

  return {
    trusted_client_count: trustedWallets.length,
    trusted_feedback_count: trustedSummaryCount,
    trusted_summary_value: trustedSummaryValue,
    trusted_summary_decimals: trustedSummaryDecimals,
    raw_client_count: clients.length,
    raw_feedback_count: rawFeedbackCount,
    last_synced_at: now,
  };
}
