import type { FastifyInstance, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  isAddress,
  keccak256,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDb, schema } from "@buildersclaw/shared/db";
import {
  decodeDnsName,
  ENS_PARENT_DOMAIN,
  ENS_SIGNATURE_TTL_SECONDS,
  textRecordFor,
} from "@buildersclaw/shared/ens";
import { fail } from "../respond";

const RESOLVER_ABI = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function addr(bytes32 node) view returns (address)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
  "function contenthash(bytes32 node) view returns (bytes)",
]);

function normalizeHex(value: string): `0x${string}` | null {
  const hex = value.endsWith(".json") ? value.slice(0, -5) : value;
  const prefixed = hex.startsWith("0x") ? hex : `0x${hex}`;
  return /^0x[0-9a-fA-F]*$/.test(prefixed) ? (prefixed as `0x${string}`) : null;
}

function requireSignerKey(): `0x${string}` {
  const raw = process.env.ENS_SIGNER_PRIVATE_KEY ?? process.env.ORGANIZER_PRIVATE_KEY;
  if (!raw) throw new Error("ENS_SIGNER_PRIVATE_KEY or ORGANIZER_PRIVATE_KEY must be set");
  return raw.startsWith("0x") ? (raw as `0x${string}`) : (`0x${raw}` as `0x${string}`);
}

async function markEnsClaimed(agentId: string, fastify: FastifyInstance) {
  try {
    await getDb()
      .update(schema.agents)
      .set({ ensSubnameClaimedAt: new Date().toISOString() })
      .where(eq(schema.agents.id, agentId));
  } catch (error) {
    fastify.log.warn({ error, agentId }, "failed to mark ENS subname claimed");
  }
}

export async function ensRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/ens/:sender/:data.json", async (req, reply) => {
    const { sender, data } = req.params as { sender: string; data: string };
    const callData = normalizeHex(data);
    if (!isAddress(sender) || !callData) return fail(reply, "Invalid CCIP-Read request", 400);
    return handleEnsLookup(fastify, reply, sender, callData);
  });

  fastify.get("/api/v1/ens/:sender/:data", async (req, reply) => {
    const { sender, data } = req.params as { sender: string; data: string };
    const callData = normalizeHex(data);
    if (!isAddress(sender) || !callData) return fail(reply, "Invalid CCIP-Read request", 400);
    return handleEnsLookup(fastify, reply, sender, callData);
  });

  fastify.post("/api/v1/ens", async (req, reply) => {
    const body = req.body as { sender?: string; data?: string } | null;
    const callData = body?.data ? normalizeHex(body.data) : null;
    if (!body?.sender || !isAddress(body.sender) || !callData) {
      return fail(reply, "Invalid CCIP-Read request", 400);
    }
    return handleEnsLookup(fastify, reply, body.sender, callData);
  });
}

async function handleEnsLookup(
  fastify: FastifyInstance,
  reply: FastifyReply,
  sender: `0x${string}`,
  callData: `0x${string}`,
) {
  let dnsName: `0x${string}`;
  let innerData: `0x${string}`;

  try {
    const outer = decodeFunctionData({ abi: RESOLVER_ABI, data: callData });
    if (outer.functionName !== "resolve") return fail(reply, "Expected resolve(bytes,bytes)", 400);
    [dnsName, innerData] = outer.args as [`0x${string}`, `0x${string}`];
  } catch {
    return fail(reply, "Invalid resolver calldata", 400);
  }

  const fullName = decodeDnsName(dnsName).toLowerCase();
  const suffix = `.${ENS_PARENT_DOMAIN}`;
  if (!fullName.endsWith(suffix)) return fail(reply, "Name is outside the ENS zone", 404);

  const slug = fullName.slice(0, -suffix.length);
  if (!slug || slug.includes(".") || !/^[a-z0-9_]+$/.test(slug)) {
    return fail(reply, "Invalid agent ENS subname", 400);
  }

  const db = getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.name, slug)).limit(1);

  let result: `0x${string}`;
  try {
    const inner = decodeFunctionData({ abi: RESOLVER_ABI, data: innerData });
    switch (inner.functionName) {
      case "addr": {
        if (inner.args.length === 1) {
          const address = agent?.walletAddress && isAddress(agent.walletAddress) ? agent.walletAddress : zeroAddress;
          result = encodeAbiParameters([{ type: "address" }], [address]);
          break;
        }

        const coinType = inner.args[1] as bigint;
        const address = coinType === 60n && agent?.walletAddress && isAddress(agent.walletAddress)
          ? agent.walletAddress
          : "0x";
        result = encodeAbiParameters([{ type: "bytes" }], [address]);
        break;
      }
      case "text": {
        const key = inner.args[1] as string;
        result = encodeAbiParameters([{ type: "string" }], [agent ? textRecordFor(agent, key) : ""]);
        break;
      }
      case "contenthash":
        result = encodeAbiParameters([{ type: "bytes" }], ["0x"]);
        break;
      default:
        return fail(reply, `Unsupported resolver function: ${inner.functionName}`, 400);
    }
  } catch {
    return fail(reply, "Invalid resolver record calldata", 400);
  }

  const expires = BigInt(Math.floor(Date.now() / 1000) + ENS_SIGNATURE_TTL_SECONDS);
  const messageHash = keccak256(
    encodePacked(
      ["bytes2", "address", "uint64", "bytes32", "bytes32"],
      ["0x1900", sender, expires, keccak256(callData), keccak256(result)],
    ),
  );
  const signature = await privateKeyToAccount(requireSignerKey()).sign({ hash: messageHash });
  const data = encodeAbiParameters(
    [{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }],
    [result, expires, signature],
  );

  if (agent && !agent.ensSubnameClaimedAt) void markEnsClaimed(agent.id, fastify);

  return reply.send({ data });
}
