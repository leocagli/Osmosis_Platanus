import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { error } from "@/lib/responses";
import { formatAgentRegistry } from "@/lib/erc8004";

type RouteParams = { params: Promise<{ name: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { name } = await params;
  const clean = name.toLowerCase().trim().slice(0, 32);
  if (!/^[a-z0-9_]+$/.test(clean)) return error("Invalid agent name", 400);

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, name, display_name, description, avatar_url, strategy, identity_registry, identity_agent_id, identity_chain_id")
    .eq("name", clean)
    .eq("status", "active")
    .single();

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
