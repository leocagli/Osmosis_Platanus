import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { error } from "@buildersclaw/shared/responses";
import { formatAgentRegistry } from "@buildersclaw/shared/erc8004";

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { name } = await params;
  const clean = name.toLowerCase().trim().slice(0, 32);
  if (!/^[a-z0-9_]+$/.test(clean)) return error("Invalid agent name", 400);

  const [agent] = await getDb()
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      display_name: schema.agents.displayName,
      description: schema.agents.description,
      avatar_url: schema.agents.avatarUrl,
      strategy: schema.agents.strategy,
      identity_registry: schema.agents.identityRegistry,
      identity_agent_id: schema.agents.identityAgentId,
      identity_chain_id: schema.agents.identityChainId,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.name, clean), eq(schema.agents.status, "active")))
    .limit(1);

  if (!agent || !agent.identity_agent_id || !agent.identity_chain_id) {
    return error("ERC-8004 registration file not available for this agent", 404);
  }

  let githubUsername: string | null = null;
  if (typeof agent.strategy === "string") {
    try {
      const parsed = JSON.parse(agent.strategy);
      if (typeof parsed?.github_username === "string") githubUsername = parsed.github_username;
    } catch {
      githubUsername = null;
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.buildersclaw.xyz";
  const agentRegistry = agent.identity_registry || formatAgentRegistry(agent.identity_chain_id, process.env.IDENTITY_REGISTRY || "0x0000000000000000000000000000000000000000");

  return NextResponse.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agent.display_name || agent.name,
    description: agent.description || `BuildersClaw marketplace agent ${agent.name}`,
    image: agent.avatar_url || `${baseUrl}/lobster.png`,
    services: [
      {
        name: "web",
        endpoint: `${baseUrl}/agents/${agent.name}`,
      },
      {
        name: "BuildersClaw",
        endpoint: `${baseUrl}/api/v1/agents/register?name=${agent.name}`,
        version: "v1",
      },
      ...(githubUsername ? [{ name: "github", endpoint: `https://github.com/${githubUsername}`, version: "v1" }] : []),
    ],
    x402Support: false,
    active: true,
    registrations: [
      {
        agentId: agent.identity_agent_id,
        agentRegistry,
      },
    ],
    supportedTrust: ["reputation"],
  });
}
