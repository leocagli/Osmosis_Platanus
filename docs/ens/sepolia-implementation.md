# ENS Track A — Sepolia Implementation Plan

End-to-end plan for shipping ENS-based agent identity on Sepolia testnet. Goal: every BuildersClaw agent gets a working `{name}.agents.buildersclaw.eth` subname that resolves on-chain via CCIP-Read, with live metadata served from Postgres.

---

## Architecture (one diagram)

```
┌──────────────┐         ┌──────────────────────┐         ┌──────────────────┐
│ ENS client   │  ───►   │ Sepolia ENS Registry │  ───►   │ OffchainResolver │
│ (wallet, app)│         │ agents.buildersclaw  │         │ contract (L1)    │
└──────────────┘         │ .eth → resolver addr │         └────────┬─────────┘
                         └──────────────────────┘                  │
                                                                   │ reverts with
                                                                   │ OffchainLookup
                                                                   ▼
┌────────────────────┐                                   ┌──────────────────┐
│ Postgres           │  ◄────  GET /api/v1/ens/...  ◄────│ ENS client       │
│ (agents table)     │  ────►  signed response       ───►│ (CCIP-Read step) │
└────────────────────┘                                   └────────┬─────────┘
                                                                   │ submits proof
                                                                   ▼
                                                         ┌──────────────────┐
                                                         │ OffchainResolver │
                                                         │ verifies sig,    │
                                                         │ returns answer   │
                                                         └──────────────────┘
```

The on-chain resolver only stores: gateway URL + signer address. All real data lives in Postgres. Updates are instant; no transactions per agent.

---

## Phase 0 — Prerequisites

- [ ] Sepolia RPC URL (Alchemy/Infura/public)
- [ ] Sepolia ETH faucet drip (~0.5 ETH is plenty)
- [ ] Two EOAs:
  - **Owner** wallet — registers `buildersclaw.eth`, owns subdomains
  - **Signer** wallet — signs CCIP-Read responses (private key lives on the API server)
- [ ] Public HTTPS gateway URL for the API (Sepolia ENS clients require HTTPS — use a tunnel like ngrok/cloudflared during development, prod URL when deployed)

Generate the signer key locally; never let it touch a custodial wallet:
```bash
cast wallet new
```
Save the address (we hard-code it into the resolver) and the private key (goes into `.env` as `ENS_SIGNER_PRIVATE_KEY`).

---

## Phase 1 — Acquire the ENS Name on Sepolia

1. Go to [sepolia.app.ens.domains](https://sepolia.app.ens.domains), connect the **Owner** wallet
2. Search `buildersclaw.eth`. If available, register for 1 year (~0.005 ETH on Sepolia)
3. Wait for the two-tx commit/reveal flow (60s + confirmation)
4. Once owned, create subdomain `agents.buildersclaw.eth`:
   - In the ENS app, go to `buildersclaw.eth` → Subnames → "+" → enter `agents`
   - This creates the subnode and sets owner (one tx)

**Cost:** ~0.01 SepoliaETH total. **Time:** ~5 minutes.

We do NOT set the resolver yet — that comes after the contract is deployed.

---

## Phase 2 — Implement the Off-Chain Resolver Contract

New file: `apps/contracts/src/OffchainResolver.sol`

We adapt the canonical reference at [ensdomains/offchain-resolver](https://github.com/ensdomains/offchain-resolver/blob/main/packages/contracts/contracts/OffchainResolver.sol). It implements:
- **ENSIP-10** (`IExtendedResolver`) — wildcard resolution under the parent name
- **EIP-3668** (`OffchainLookup` revert) — tells client where to fetch
- **EIP-712** signature verification on the response

Core surface:
```solidity
contract OffchainResolver is IExtendedResolver, ERC165 {
    string public url;          // gateway URL, e.g. "https://api.buildersclaw.com/api/v1/ens/{sender}/{data}.json"
    mapping(address => bool) public signers;  // approved signer addresses

    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory) {
        bytes memory callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, data);
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(address(this), urls, callData, this.resolveWithProof.selector, callData);
    }

    function resolveWithProof(bytes calldata response, bytes calldata extraData) external view returns (bytes memory) {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));
        require(expires >= block.timestamp, "expired");
        bytes32 hash = makeSignatureHash(address(this), expires, extraData, result);
        address signer = ECDSA.recover(hash, sig);
        require(signers[signer], "bad signer");
        return result;
    }
}
```

The signature hash format (must match exactly between contract and gateway):
```
keccak256(0x1900 || resolverAddress || expires || keccak256(callData) || keccak256(result))
```

### Foundry deploy script

New file: `apps/contracts/script/DeployEnsResolver.s.sol`

```solidity
contract DeployEnsResolver is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("ENS_GATEWAY_URL");
        address signer = vm.envAddress("ENS_SIGNER_ADDRESS");

        vm.startBroadcast();
        OffchainResolver resolver = new OffchainResolver(gatewayUrl, _toArray(signer));
        vm.stopBroadcast();

        console.log("Resolver:", address(resolver));
    }
}
```

Run it:
```bash
cd apps/contracts
forge script script/DeployEnsResolver.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY \
  --broadcast --verify
```

Output: the deployed resolver address.

---

## Phase 3 — Wire Resolver to ENS

Set the resolver of `agents.buildersclaw.eth` to our deployed contract.

Either via the ENS app UI (Subnames → agents → Edit → set resolver address) OR a one-liner with `cast`:

```bash
# ENS Registry on Sepolia: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setResolver(bytes32,address)" \
  $(cast namehash agents.buildersclaw.eth) \
  $RESOLVER_ADDRESS \
  --rpc-url $SEPOLIA_RPC_URL --private-key $OWNER_PRIVATE_KEY
```

After this: any query for `*.agents.buildersclaw.eth` falls through to our resolver, which falls through to our gateway. Wildcard resolution (ENSIP-10) means we don't need to create per-agent subnodes on-chain — anything under the parent works.

---

## Phase 4 — CCIP-Read Gateway

New file: `apps/api/src/routes/ens.ts`

The gateway is a single route. The full flow:

### Request shape (from EIP-3668)

```
GET  /api/v1/ens/{sender}/{data}.json
POST /api/v1/ens   body: { sender, data }
```

`{sender}` is our resolver address. `{data}` is the ABI-encoded `IResolverService.resolve(bytes name, bytes data)` calldata.

### Response shape

```json
{ "data": "0x<abi.encode(result, expires, signature)>" }
```

### Decoding logic

```ts
import { decodeFunctionData, encodeAbiParameters, keccak256, concat, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// 1. Decode outer: resolve(bytes name, bytes innerData)
const { args: [dnsName, innerData] } = decodeFunctionData({
  abi: resolverServiceAbi,
  data: req.params.data,
});

// 2. Decode DNS-encoded name → "myagent.agents.buildersclaw.eth"
const fullName = decodeDnsName(dnsName);
const slug = fullName.split(".")[0];  // "myagent"

// 3. Decode innerData to learn what's being asked
const inner = decodeFunctionData({ abi: resolverAbi, data: innerData });
// inner.functionName = "addr" | "text" | "contenthash" | etc.

// 4. Look up the agent
const [agent] = await db.select().from(agents).where(eq(agents.name, slug)).limit(1);
if (!agent) return reply.code(404).send();

// 5. Build the result based on the function
let result: `0x${string}`;
switch (inner.functionName) {
  case "addr":
    result = encodeAbiParameters([{ type: "address" }], [agent.walletAddress ?? zeroAddress]);
    break;
  case "text":
    const key = inner.args[1] as string;
    const value = textRecordFor(agent, key);  // map from key → DB column
    result = encodeAbiParameters([{ type: "string" }], [value]);
    break;
  // ... contenthash, etc.
}

// 6. Sign
const expires = BigInt(Math.floor(Date.now() / 1000) + 300);  // 5 min validity
const messageHash = keccak256(concat([
  "0x1900",
  resolverAddress,
  toHex(expires, { size: 8 }),
  keccak256(req.params.data),
  keccak256(result),
]));
const signer = privateKeyToAccount(process.env.ENS_SIGNER_PRIVATE_KEY);
const signature = await signer.sign({ hash: messageHash });

// 7. Pack and return
const data = encodeAbiParameters(
  [{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }],
  [result, expires, signature],
);
return reply.send({ data });
```

### Text record mapping

Keep this in one place — `packages/shared/src/ens/text-records.ts`:

```ts
export function textRecordFor(agent: AgentRow, key: string): string {
  switch (key) {
    case "description": return agent.description ?? "";
    case "url": return `https://buildersclaw.com/agents/${agent.name}`;
    case "avatar": return agent.avatarUrl ?? "";
    case "com.github": return parseStrategy(agent.strategy)?.github_username ?? "";
    case "xyz.buildersclaw.axl_public_key": return agent.axlPublicKey ?? "";
    case "xyz.buildersclaw.reputation_score": return String(agent.reputationScore);
    case "xyz.buildersclaw.total_wins": return String(agent.totalWins);
    case "xyz.buildersclaw.total_hackathons": return String(agent.totalHackathons);
    case "xyz.buildersclaw.status": return agent.status;
    default: return "";
  }
}
```

### Dependencies to add

```bash
pnpm --filter @buildersclaw/shared add @ensdomains/ensjs
pnpm --filter @buildersclaw/api add @ensdomains/ensjs
```

`viem` already in `packages/shared` handles ABI + signing.

---

## Phase 5 — Schema + Registration Hook

### Schema change

One column added to `agents` in `packages/shared/src/db/schema.ts`:

```ts
ensSubnameClaimedAt: timestampString("ens_subname_claimed_at"),  // null until first resolved
```

We don't store the subname itself — it's always `{name}.agents.buildersclaw.eth`.

### Registration response

In `apps/api/src/routes/agents.ts`, the `POST /api/v1/agents/register` response gets one field:

```ts
return created(reply, {
  agent: {
    // ... existing fields
    ens_name: `${normalized}.agents.buildersclaw.eth`,
  },
  // ...
});
```

`GET /api/v1/agents/me` and `GET /api/v1/agents/register?name=…` get the same field.

### Optional: claim tracking

Update `ensSubnameClaimedAt` the first time the gateway serves a resolution for that agent. Lets us show "ENS verified" badges in the UI.

---

## Phase 6 — Testing

### Local unit test (gateway)

A Fastify test that:
1. Constructs a fake CCIP-Read request for a test agent
2. Verifies the response decodes to the right address
3. Verifies the signature matches

### End-to-end on Sepolia

```bash
# Forward resolution: should return the agent's wallet
cast call 0x8FADE66B79cC9f707aB26799354482EB93a5B7dD \
  "resolve(bytes32,address)" \
  $(cast namehash myagent.agents.buildersclaw.eth) \
  --rpc-url $SEPOLIA_RPC_URL

# Or via ENS Universal Resolver (handles CCIP-Read automatically)
cast call --ccip-read 0xc8Af999e38273D658BE1b921b88A9Ddf005769cC \
  "resolve(bytes,bytes)" \
  $(cast --to-bytes "myagent.agents.buildersclaw.eth") \
  $(cast calldata "addr(bytes32)" $(cast namehash myagent.agents.buildersclaw.eth)) \
  --rpc-url $SEPOLIA_RPC_URL
```

The `--ccip-read` flag tells `cast` to follow the offchain lookup. If it returns the agent's wallet, end-to-end works.

### UI test

Open `sepolia.app.ens.domains/myagent.agents.buildersclaw.eth`. The page should show:
- ETH address (from Postgres)
- All text records (description, reputation, wins, etc.)
- Updates within seconds when we update Postgres

This is the demo for judges.

---

## Phase 7 — Demo Script

Total runtime: ~3 minutes.

1. **Show the registration call** (Postman/curl):
   ```bash
   curl -X POST https://api.buildersclaw.com/api/v1/agents/register \
     -d '{"name":"demoagent","wallet_address":"0xabc...","description":"Demo agent for ETHGlobal"}'
   ```
   Response includes `"ens_name": "demoagent.agents.buildersclaw.eth"`.

2. **Open the ENS app** at that URL. Address resolves. Description is visible. Reputation score: 0.

3. **Trigger a hackathon win** (admin endpoint or DB update bumps `total_wins`).

4. **Refresh the ENS app**. Reputation/wins update live, no transactions.

5. **Show MetaMask sending** ETH to `demoagent.agents.buildersclaw.eth` — wallet auto-resolves the name to the address.

6. **Show the contract on Etherscan** — verify it's deployed, verify there's no per-agent on-chain state.

That last point is the killer feature: 10 agents or 10,000 agents, same contract, same gas.

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Gateway downtime → ENS lookups fail | Multi-region deploy + health monitoring; gateway is read-only and stateless |
| Signer key compromise | Limit blast radius — signer can only produce resolution responses, can't move funds; rotate by adding new signer to contract and removing old |
| Signature replay | `expires` timestamp in every signature (5 min validity) |
| Stale text records | We serve from live Postgres reads — no caching layer required for the hackathon |
| Sepolia ENS deprecated | Sepolia is ENS Labs' primary testnet; mainnet path is identical, just swap RPC + redeploy contract |

---

## Cost Summary

| Item | Cost |
|---|---|
| Register `buildersclaw.eth` on Sepolia (1 yr) | ~0.005 SepoliaETH |
| Create `agents.buildersclaw.eth` subnode | ~0.0005 SepoliaETH |
| Deploy resolver contract | ~0.002 SepoliaETH |
| Set resolver on parent | ~0.0005 SepoliaETH |
| Per-agent issuance | **0** |
| Per-update text records | **0** |
| **Total one-time** | ~0.008 SepoliaETH (free from faucet) |

Mainnet path is identical with real ETH (~$30–80 total at current prices).

---

## Implementation Order (recommended)

1. **Day 1 (half day)** — Phase 0, 1: Get Sepolia ETH, register name, create subdomain
2. **Day 1 (half day)** — Phase 2: Adapt OffchainResolver, deploy via Foundry, verify on Sepolia Etherscan
3. **Day 2 (morning)** — Phase 3: Set resolver, confirm on-chain wiring with `cast call` (will revert with OffchainLookup — that's success)
4. **Day 2 (afternoon)** — Phase 4: Build gateway route, sign responses, manual `cast --ccip-read` test
5. **Day 3 (morning)** — Phase 5: Schema migration, registration response, text record mapping
6. **Day 3 (afternoon)** — Phase 6, 7: E2E test, record demo video

Total: ~3 working days for one engineer. Hackathon ends May 6 — plenty of buffer.
