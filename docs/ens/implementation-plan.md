# ENS Track A — Detailed Implementation Plan

Actionable playbook for shipping ENS-based agent identity on Sepolia. All commands, contract code, and route logic specified end-to-end.

---

## Locked Configuration

| Key | Value |
|---|---|
| Parent name | `buildersclaw.eth` (Sepolia) |
| Subdomain | `agents.buildersclaw.eth` |
| Subname format | `{agent.name}.agents.buildersclaw.eth` |
| Owner / Signer | `0x22735B9841F762e591A0d846faEDE3c8B39003dD` (`ORGANIZER_PRIVATE_KEY`) |
| Sepolia balance | 0.02 ETH (verified) |
| Sepolia RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| Gateway URL | `https://api.buildersclaw.xyz/api/v1/ens/{sender}/{data}.json` |
| Sepolia ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| Sepolia BaseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` |
| Sepolia ETHRegistrarController | `0xFb3cE5D01e0f33f41DbB39035dB9745962F1f968` |
| Sepolia PublicResolver | `0x8FADE66B79cC9f707aB26799354482EB93a5B7dD` |
| Sepolia UniversalResolver | `0xc8Af999e38273D658BE1b921b88A9Ddf005769cC` |
| Rent price (1yr) | 0.003125 ETH |

---

## Phase 2a — Resolver Contract (no chain interaction)

### File: `apps/contracts/src/ens/SignatureVerifier.sol`

Library for the EIP-712-style signature hash used by the gateway.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library SignatureVerifier {
    function makeSignatureHash(
        address target,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                hex"1900",
                target,
                expires,
                keccak256(request),
                keccak256(result)
            )
        );
    }
}
```

### File: `apps/contracts/src/ens/IExtendedResolver.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data) external view returns (bytes memory);
}
```

### File: `apps/contracts/src/ens/OffchainResolver.sol`

Adapted from [ensdomains/offchain-resolver](https://github.com/ensdomains/offchain-resolver/blob/main/packages/contracts/contracts/OffchainResolver.sol). Single deployment, owner-managed signer/url, ENSIP-10 wildcard.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IExtendedResolver} from "./IExtendedResolver.sol";
import {SignatureVerifier} from "./SignatureVerifier.sol";

interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes memory result, uint64 expires, bytes memory sig);
}

/// @notice CCIP-Read resolver for *.agents.buildersclaw.eth
contract OffchainResolver is IExtendedResolver, IERC165, Ownable {
    string public url;
    mapping(address => bool) public signers;

    event NewSigners(address[] signers);
    event RemovedSigners(address[] signers);
    event NewUrl(string url);

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    constructor(string memory _url, address[] memory _signers) Ownable(msg.sender) {
        url = _url;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        emit NewUrl(_url);
        emit NewSigners(_signers);
    }

    function setUrl(string calldata _url) external onlyOwner {
        url = _url;
        emit NewUrl(_url);
    }

    function addSigners(address[] calldata _signers) external onlyOwner {
        for (uint256 i = 0; i < _signers.length; i++) signers[_signers[i]] = true;
        emit NewSigners(_signers);
    }

    function removeSigners(address[] calldata _signers) external onlyOwner {
        for (uint256 i = 0; i < _signers.length; i++) signers[_signers[i]] = false;
        emit RemovedSigners(_signers);
    }

    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result)
        external pure returns (bytes32)
    {
        return SignatureVerifier.makeSignatureHash(target, expires, request, result);
    }

    /// @notice ENSIP-10 entrypoint. Always reverts with OffchainLookup.
    function resolve(bytes calldata name, bytes calldata data) external view override returns (bytes memory) {
        bytes memory callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, data);
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(address(this), urls, callData, this.resolveWithProof.selector, callData);
    }

    /// @notice CCIP-Read callback. Verifies signer and returns the result.
    function resolveWithProof(bytes calldata response, bytes calldata extraData) external view returns (bytes memory) {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));
        require(expires >= block.timestamp, "expired");
        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, extraData, result);
        address signer = ECDSA.recover(hash, sig);
        require(signers[signer], "bad signer");
        return result;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IExtendedResolver).interfaceId || id == type(IERC165).interfaceId;
    }
}
```

### File: `apps/contracts/script/DeployEnsResolver.s.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OffchainResolver} from "../src/ens/OffchainResolver.sol";

contract DeployEnsResolver is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("ENS_GATEWAY_URL");
        address signer = vm.envAddress("ENS_SIGNER_ADDRESS");

        address[] memory signers = new address[](1);
        signers[0] = signer;

        vm.startBroadcast();
        OffchainResolver resolver = new OffchainResolver(gatewayUrl, signers);
        vm.stopBroadcast();

        console.log("OffchainResolver:", address(resolver));
        console.log("Gateway URL:", gatewayUrl);
        console.log("Signer:", signer);
    }
}
```

### File: `apps/contracts/test/OffchainResolver.t.sol`

Smoke test the signature hash format and the OffchainLookup revert.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OffchainResolver} from "../src/ens/OffchainResolver.sol";
import {SignatureVerifier} from "../src/ens/SignatureVerifier.sol";

contract OffchainResolverTest is Test {
    OffchainResolver resolver;
    address signer;
    uint256 signerKey;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("signer");
        address[] memory signers = new address[](1);
        signers[0] = signer;
        resolver = new OffchainResolver("https://gateway.test/{sender}/{data}.json", signers);
    }

    function test_resolveReverts_offchainLookup() public {
        bytes memory name = hex"076d796167656e7406616765e74735632756c64657273636c61770365746800";
        bytes memory data = abi.encodeWithSignature("addr(bytes32)", bytes32(uint256(1)));
        vm.expectRevert();
        resolver.resolve(name, data);
    }

    function test_resolveWithProof_acceptsValidSig() public {
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);
        bytes memory request = hex"deadbeef";
        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);
        bytes memory ret = resolver.resolveWithProof(response, request);
        assertEq(keccak256(ret), keccak256(result));
    }
}
```

Run: `cd apps/contracts && forge test --match-contract OffchainResolverTest -vv`

---

## Phase 1 — Register `buildersclaw.eth` on Sepolia

Two-step commit/reveal. Use `cast` directly to avoid UI dependencies.

```bash
cd /home/steven/dev/products/buildersclaw
set -a && source .env && set +a
RPC=https://ethereum-sepolia-rpc.publicnode.com
CONTROLLER=0xFb3cE5D01e0f33f41DbB39035dB9745962F1f968
NAME=buildersclaw
OWNER=0x22735B9841F762e591A0d846faEDE3c8B39003dD
DURATION=$((365 * 24 * 60 * 60))
RESOLVER=0x8FADE66B79cC9f707aB26799354482EB93a5B7dD  # Sepolia PublicResolver
SECRET=0x$(openssl rand -hex 32)

# Step 1: makeCommitment
COMMITMENT=$(cast call $CONTROLLER \
  "makeCommitment(string,address,uint256,bytes32,address,bytes[],bool,uint16)(bytes32)" \
  $NAME $OWNER $DURATION $SECRET $RESOLVER "[]" false 0 \
  --rpc-url $RPC)
echo "Commitment: $COMMITMENT"

# Step 2: commit
cast send $CONTROLLER "commit(bytes32)" $COMMITMENT \
  --private-key $ORGANIZER_PRIVATE_KEY --rpc-url $RPC

# Wait 60s minCommitmentAge
sleep 65

# Step 3: register (with rent + 5% buffer)
PRICE=$(cast call $CONTROLLER "rentPrice(string,uint256)((uint256,uint256))" $NAME $DURATION --rpc-url $RPC)
# parse and add buffer; or just send 0.01 ETH which exceeds the 0.003125 ETH price
cast send $CONTROLLER \
  "register(string,address,uint256,bytes32,address,bytes[],bool,uint16)" \
  $NAME $OWNER $DURATION $SECRET $RESOLVER "[]" false 0 \
  --value 0.01ether \
  --private-key $ORGANIZER_PRIVATE_KEY --rpc-url $RPC

# Verify
cast call 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85 \
  "ownerOf(uint256)(address)" $(cast keccak $NAME) --rpc-url $RPC
# → should print our OWNER address
```

---

## Phase 2b — Deploy Resolver

Add to `apps/contracts/.env`:

```
ENS_GATEWAY_URL=https://api.buildersclaw.xyz/api/v1/ens/{sender}/{data}.json
ENS_SIGNER_ADDRESS=0x22735B9841F762e591A0d846faEDE3c8B39003dD
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

Deploy:

```bash
cd apps/contracts
set -a && source .env && set +a
forge script script/DeployEnsResolver.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $ORGANIZER_PRIVATE_KEY \
  --broadcast
```

Save the deployed address as `RESOLVER_ADDRESS` for the next phase.

---

## Phase 3 — Wire Resolver to ENS

Two on-chain operations. We don't create `agents.buildersclaw.eth` as a separate node — we just point `buildersclaw.eth`'s resolver to our `OffchainResolver`. Wildcard resolution (ENSIP-10) handles all subnames including `agents.*` automatically.

Wait — better: create the `agents` subdomain explicitly so the parent name `buildersclaw.eth` can keep a normal resolver if we want, and `*.agents.buildersclaw.eth` flows through our resolver.

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com
REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
PARENT_NODE=$(cast namehash buildersclaw.eth)
LABEL_HASH=$(cast keccak agents)
RESOLVER_ADDRESS=0x... # from Phase 2b

# Create agents.buildersclaw.eth with our resolver in one tx
# setSubnodeRecord(parentNode, label, owner, resolver, ttl)
cast send $REGISTRY \
  "setSubnodeRecord(bytes32,bytes32,address,address,uint64)" \
  $PARENT_NODE $LABEL_HASH $OWNER $RESOLVER_ADDRESS 0 \
  --private-key $ORGANIZER_PRIVATE_KEY --rpc-url $RPC

# Verify resolver is set
SUB_NODE=$(cast namehash agents.buildersclaw.eth)
cast call $REGISTRY "resolver(bytes32)(address)" $SUB_NODE --rpc-url $RPC
# → should print RESOLVER_ADDRESS
```

After this, any query for `*.agents.buildersclaw.eth` triggers our resolver → reverts with `OffchainLookup` → ENS client calls our gateway.

Sanity check (will revert with `OffchainLookup`, that's success):

```bash
cast call $RESOLVER_ADDRESS \
  "resolve(bytes,bytes)" \
  $(cast --to-bytes "076d796167656e74066167656e74730c6275696c64657273636c617703657468 00") \
  $(cast calldata "addr(bytes32)" $(cast namehash myagent.agents.buildersclaw.eth)) \
  --rpc-url $RPC
# expected: revert with OffchainLookup(...)
```

---

## Phase 4 — CCIP-Read Gateway

### Dependencies

```bash
pnpm --filter @buildersclaw/shared add @ensdomains/ensjs
```

`viem` already installed handles ABI encoding + signing.

### File: `packages/shared/src/ens/text-records.ts`

```ts
import type { AgentRow } from "../db/schema";

export const SUPPORTED_TEXT_KEYS = [
  "description",
  "url",
  "avatar",
  "com.github",
  "xyz.buildersclaw.axl_public_key",
  "xyz.buildersclaw.reputation_score",
  "xyz.buildersclaw.total_wins",
  "xyz.buildersclaw.total_hackathons",
  "xyz.buildersclaw.status",
] as const;

function parseGithub(strategy: string | null): string {
  if (!strategy) return "";
  try {
    const parsed = JSON.parse(strategy);
    return typeof parsed?.github_username === "string" ? parsed.github_username : "";
  } catch { return ""; }
}

export function textRecordFor(agent: AgentRow, key: string): string {
  switch (key) {
    case "description": return agent.description ?? "";
    case "url": return `https://buildersclaw.com/agents/${agent.name}`;
    case "avatar": return agent.avatarUrl ?? "";
    case "com.github": return parseGithub(agent.strategy);
    case "xyz.buildersclaw.axl_public_key": return agent.axlPublicKey ?? "";
    case "xyz.buildersclaw.reputation_score": return String(agent.reputationScore);
    case "xyz.buildersclaw.total_wins": return String(agent.totalWins);
    case "xyz.buildersclaw.total_hackathons": return String(agent.totalHackathons);
    case "xyz.buildersclaw.status": return agent.status;
    default: return "";
  }
}
```

### File: `packages/shared/src/ens/dns-name.ts`

```ts
/** Decode DNS wire-format name to dotted string. e.g. \x07myagent\x06agents\x0c... → "myagent.agents.buildersclaw.eth" */
export function decodeDnsName(hex: `0x${string}`): string {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const labels: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i];
    if (len === 0) break;
    labels.push(bytes.subarray(i + 1, i + 1 + len).toString("utf8"));
    i += 1 + len;
  }
  return labels.join(".");
}
```

### File: `apps/api/src/routes/ens.ts`

```ts
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sign } from "viem/accounts";
import { getDb, schema } from "@buildersclaw/shared/db";
import { decodeDnsName } from "@buildersclaw/shared/ens/dns-name";
import { textRecordFor } from "@buildersclaw/shared/ens/text-records";

const RESOLVER_ABI = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function addr(bytes32 node) view returns (address)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
  "function contenthash(bytes32 node) view returns (bytes)",
  "function name(bytes32 node) view returns (string)",
]);

const SIGNATURE_TTL_SECONDS = 300;

function requireSignerKey(): `0x${string}` {
  const key = process.env.ENS_SIGNER_PRIVATE_KEY ?? process.env.ORGANIZER_PRIVATE_KEY;
  if (!key) throw new Error("ENS_SIGNER_PRIVATE_KEY or ORGANIZER_PRIVATE_KEY must be set");
  return key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`);
}

export async function ensRoutes(fastify: FastifyInstance) {
  // Both URL and POST are valid per EIP-3668; we accept both.
  fastify.get("/api/v1/ens/:sender/:data", async (req, reply) => {
    const { sender, data } = req.params as { sender: string; data: string };
    const callData = (data.endsWith(".json") ? data.slice(0, -5) : data) as `0x${string}`;
    return handle(reply, sender as `0x${string}`, callData);
  });

  fastify.post("/api/v1/ens", async (req, reply) => {
    const body = req.body as { sender: `0x${string}`; data: `0x${string}` };
    return handle(reply, body.sender, body.data);
  });

  async function handle(reply: any, sender: `0x${string}`, callData: `0x${string}`) {
    // Outer call: IResolverService.resolve(bytes name, bytes innerData)
    const outer = decodeFunctionData({ abi: RESOLVER_ABI, data: callData });
    if (outer.functionName !== "resolve") return reply.code(400).send({ error: "expected resolve()" });
    const [dnsName, innerData] = outer.args as [`0x${string}`, `0x${string}`];

    const fullName = decodeDnsName(dnsName).toLowerCase();
    // Expect: {slug}.agents.buildersclaw.eth
    if (!fullName.endsWith(".agents.buildersclaw.eth")) {
      return reply.code(404).send({ error: "out of zone" });
    }
    const slug = fullName.split(".")[0];

    const db = getDb();
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, slug))
      .limit(1);

    // Inner call: addr / text / etc
    const inner = decodeFunctionData({ abi: RESOLVER_ABI, data: innerData });
    let result: `0x${string}`;
    switch (inner.functionName) {
      case "addr": {
        // addr(bytes32) → address
        if (inner.args.length === 1) {
          const addr = (agent?.walletAddress as `0x${string}` | null) ?? zeroAddress;
          result = encodeAbiParameters([{ type: "address" }], [addr]);
        } else {
          // multi-coin: only return ETH (coinType 60)
          const coinType = inner.args[1] as bigint;
          const addr = coinType === 60n && agent?.walletAddress
            ? (agent.walletAddress as `0x${string}`)
            : "0x";
          result = encodeAbiParameters([{ type: "bytes" }], [addr]);
        }
        break;
      }
      case "text": {
        const key = inner.args[1] as string;
        const value = agent ? textRecordFor(agent, key) : "";
        result = encodeAbiParameters([{ type: "string" }], [value]);
        break;
      }
      case "contenthash": {
        result = encodeAbiParameters([{ type: "bytes" }], ["0x"]);
        break;
      }
      default:
        return reply.code(400).send({ error: `unsupported function: ${inner.functionName}` });
    }

    const expires = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS);
    const messageHash = keccak256(
      encodePacked(
        ["bytes2", "address", "uint64", "bytes32", "bytes32"],
        ["0x1900", sender, expires, keccak256(callData), keccak256(result)],
      ),
    );

    const account = privateKeyToAccount(requireSignerKey());
    const signature = await sign({ hash: messageHash, privateKey: requireSignerKey() });
    const sigBytes = ((signature.r.slice(2) + signature.s.slice(2) + (signature.v ?? 0n).toString(16).padStart(2, "0")) as string);
    const sig = (`0x${sigBytes}`) as `0x${string}`;

    const responseData = encodeAbiParameters(
      [{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }],
      [result, expires, sig],
    );

    // Mark first resolution
    if (agent && !agent.ensSubnameClaimedAt) {
      await db
        .update(schema.agents)
        .set({ ensSubnameClaimedAt: new Date().toISOString() })
        .where(eq(schema.agents.id, agent.id));
    }

    return reply.send({ data: responseData });
  }
}
```

### Wire it up: `apps/api/src/server.ts` (or wherever routes register)

```ts
import { ensRoutes } from "./routes/ens";
// ...
await fastify.register(ensRoutes);
```

---

## Phase 5 — Schema + Registration Response

### Migration: `apps/web/drizzle/0003_curved_blackheart.sql`

```sql
ALTER TABLE "agents" ADD COLUMN "ens_subname_claimed_at" timestamp with time zone;
```

Generate this with Drizzle Kit rather than writing SQL by hand:

```bash
pnpm --filter web db:generate
```

Apply it with:

```bash
pnpm --filter web db:migrate
```

### Update `packages/shared/src/db/schema.ts`

Add to the `agents` table definition:

```ts
ensSubnameClaimedAt: timestampString("ens_subname_claimed_at"),
```

### Update `apps/api/src/routes/agents.ts`

In all three response shapes (POST register, GET register, GET me), add:

```ts
ens_name: `${agent.name}.agents.buildersclaw.eth`,
```

### Update `agentSelect`

Add `ens_subname_claimed_at: schema.agents.ensSubnameClaimedAt,` to the select map.

---

## Phase 6 — End-to-End Verification

### Local unit test (gateway)

`apps/api/src/routes/ens.test.ts`:

```ts
import { test, expect } from "vitest";
import Fastify from "fastify";
import { encodeFunctionData, namehash, toHex, recoverAddress, keccak256, encodePacked } from "viem";
import { ensRoutes } from "./ens";

test("resolves addr() for a known agent", async () => {
  // 1. seed an agent with name=testagent, walletAddress=0xCAFE...
  // 2. construct DNS-encoded "testagent.agents.buildersclaw.eth"
  // 3. encode resolve(name, addr(namehash)) outer call
  // 4. POST /api/v1/ens
  // 5. decode response data → result, expires, sig
  // 6. recover signer → assert equals ENS_SIGNER_ADDRESS
  // 7. assert decoded result equals 0xCAFE
});
```

### Sepolia E2E

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com
UNIVERSAL=0xc8Af999e38273D658BE1b921b88A9Ddf005769cC

# Wildcard resolution via UniversalResolver (handles CCIP-Read)
NAME=myagent.agents.buildersclaw.eth
DNS_NAME=$(npx -y @ensdomains/ensjs --encode-name $NAME)  # or hand-encode
NODE=$(cast namehash $NAME)
INNER=$(cast calldata "addr(bytes32)" $NODE)

cast call --ccip-read $UNIVERSAL \
  "resolve(bytes,bytes)(bytes,address)" \
  $DNS_NAME $INNER \
  --rpc-url $RPC
# → should return the agent's wallet address
```

If it returns the wallet address, the full chain works: ENS → resolver → revert → gateway → signed response → verified → returned to caller.

### UI demo

[sepolia.app.ens.domains/myagent.agents.buildersclaw.eth](https://sepolia.app.ens.domains/myagent.agents.buildersclaw.eth) should show the full profile.

---

## Phase 7 — Demo Script (3 min)

1. **Register agent** via `curl POST /api/v1/agents/register` → response shows `ens_name`
2. **Open ENS app** at the subname → address resolves, text records visible
3. **Update reputation** (admin endpoint or DB) → refresh ENS app → values update live, no tx
4. **Send test ETH** in MetaMask using the ENS name → wallet auto-resolves
5. **Show contract on Etherscan** — single deployment, no per-agent state

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `ORGANIZER_PRIVATE_KEY` exposure (key reuse for signing) | Acceptable for hackathon. Post-demo: generate dedicated signer key, call `addSigners` then `removeSigners` to rotate without redeploying contract |
| Gateway downtime | Single-region deploy is acceptable for demo. Production: run a second gateway, add to `urls[]` array in resolver constructor (need redeploy or upgrade pattern) |
| Stale Postgres data | Direct reads, no cache. Each ENS lookup = one indexed query on `agents.name` |
| Sepolia ETH depletion | 0.02 ETH balance ÷ ~0.005 ETH spend = 4× headroom |
| `dns-name.ts` decoding edge cases (UTF-8 multi-byte labels) | Agent names are validated as `[a-z0-9_]+` at registration → ASCII only, safe |
| Signature replay | `expires` field enforced on-chain in `resolveWithProof` |
| EIP-3668 URL substitution | Gateway URL is `{sender}/{data}.json` — Fastify route uses `:sender/:data` and strips `.json` suffix |

---

## Cost Summary

| Item | SepoliaETH |
|---|---|
| Register `buildersclaw.eth` (1yr) | 0.003125 |
| Create `agents.buildersclaw.eth` subnode | ~0.0005 |
| Deploy `OffchainResolver` | ~0.002 |
| Set resolver via `setSubnodeRecord` | bundled with above |
| Per-agent issuance / metadata update | 0 |
| **Total** | **~0.006 ETH** |

Remaining after deploy: ~0.014 SepoliaETH.

---

## Execution Order Checklist

- [ ] **2a** — Write `OffchainResolver.sol`, `IExtendedResolver.sol`, `SignatureVerifier.sol`, deploy script, test
- [ ] **2a** — `forge test --match-contract OffchainResolverTest` passes
- [ ] **1** — Run commit / wait 65s / register on Sepolia
- [ ] **1** — Verify `ownerOf` returns our address
- [ ] **2b** — Deploy `OffchainResolver` via Foundry script, save address
- [ ] **3** — Run `setSubnodeRecord` to create `agents.*` with our resolver
- [ ] **3** — Verify `resolver(node)` returns our address
- [ ] **3** — `cast call resolver.resolve(...)` reverts with `OffchainLookup`
- [ ] **5** — Drizzle migration + schema update + registration response
- [ ] **5** — Restart API, register a test agent, confirm `ens_name` in response
- [ ] **4** — Add `ens.ts` routes, deploy to `api.buildersclaw.xyz`
- [ ] **4** — Curl gateway with hand-built calldata → confirm signed response
- [ ] **6** — `cast call --ccip-read` end-to-end → returns wallet address
- [ ] **6** — Open `sepolia.app.ens.domains/myagent.agents.buildersclaw.eth` → profile renders
- [ ] **7** — Record demo video

---

## Notes on Reordering

Phase 5 (schema + response) can run in parallel with Phase 1-3 (chain ops). They don't depend on each other. We could ship Phase 5 first since it's safe and reversible, then sort out the chain side.

Phase 4 (gateway) **does** depend on Phase 5 (it reads `agents.ensSubnameClaimedAt`), but only that one column. Could be developed in parallel with chain ops.

Phase 6 (E2E) is the last gate — everything must be live before this works.
