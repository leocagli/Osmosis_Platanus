# ENS Track A — Implementation Status

Snapshot of work completed and remaining work for the ETHGlobal OpenAgents ENS prize.

Last updated: 2026-05-03

---

## On-Chain State (Sepolia)

| Resource | Value |
|---|---|
| Owner / signer wallet | `0x22735B9841F762e591A0d846faEDE3c8B39003dD` |
| `buildersclaw.eth` registered | ✅ owned by the wallet above |
| `agents.buildersclaw.eth` subnode | ✅ created, owned by wallet above |
| `OffchainResolver` deployed | ✅ `0x0794B339AE017DFE616cE2468204681B469ecB57` |
| Resolver wired to `agents.buildersclaw.eth` | ✅ confirmed via `cast call resolver(node)` |
| `OffchainLookup` revert verified | ✅ live `cast call resolver.resolve(...)` reverts with the gateway URL embedded |

### Sepolia tx hashes

- ENS commit: `0x3ec6b31a02be690902c09f7efcebf9bb4ec06e1fb856d019750dd727b9cc7204`
- ENS register: `0x20411f4eb7c1f77b11d7fbdf982d061fa4a33f1b7ecbd23a3f52c267eba78414`
- `setSubnodeRecord` (creates `agents.*` with our resolver): `0xabbfb41238813a5efbaddfe4ffb8ae1f83234fab7540c6098240b96e70794f65`
- `OffchainResolver` deploy: see `apps/contracts/broadcast/DeployEnsResolver.s.sol/11155111/run-latest.json`

### Sepolia ENS contract addresses (reference)

| Contract | Address |
|---|---|
| ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| BaseRegistrar (.eth NFT) | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` |
| ETHRegistrarController (V2 struct API) | `0xFb3cE5D01e0f33f41DbB39035dB9745962F1f968` |
| PublicResolver | `0x8FADE66B79cC9f707aB26799354482EB93a5B7dD` |
| UniversalResolver | `0xc8Af999e38273D658BE1b921b88A9Ddf005769cC` |

**Important note:** The Sepolia controller uses a single-struct argument
`makeCommitment((string,address,uint256,bytes32,address,bytes[],uint8,bytes32))` and
`register((string,address,uint256,bytes32,address,bytes[],uint8,bytes32))` — not the
flat-args V1 signature. The 8th field is `bytes32 referrer`, the 7th is
`uint8 reverseRecord` (0 = no, 1 = ETH primary, 2 = default primary, 3 = both).

### Sepolia spend so far

~0.005 ETH. Remaining balance ≈ 0.015 ETH. Plenty for redeploys / iteration.

---

## Off-Chain Code Changes

### Contracts (`apps/contracts/`)

| File | Status |
|---|---|
| `src/ens/IExtendedResolver.sol` | ✅ created |
| `src/ens/SignatureVerifier.sol` | ✅ created |
| `src/ens/OffchainResolver.sol` | ✅ created — ENSIP-10 + EIP-3668 + ECDSA verifier |
| `script/DeployEnsResolver.s.sol` | ✅ created |
| `test/OffchainResolver.t.sol` | ✅ created — 8 tests, all passing (`forge test --match-contract OffchainResolverTest`) |
| `.env` | ✅ ENS_GATEWAY_URL, ENS_SIGNER_ADDRESS, SEPOLIA_RPC_URL appended |
| `dependencies/` | ✅ soldeer install ran; `forge-std` and `@openzeppelin-contracts` materialized |

### Database (`packages/shared/`, `apps/web/drizzle/`)

| File | Status |
|---|---|
| `packages/shared/src/db/schema.ts` | ✅ added `ensSubnameClaimedAt` column on `agents` |
| `apps/web/drizzle/0003_curved_blackheart.sql` | ✅ generated with Drizzle Kit from the shared schema |
| Migration applied to live DB | ✅ `pnpm --filter web db:migrate` completed successfully |

### Shared helpers (`packages/shared/`)

| File | Status |
|---|---|
| `packages/shared/src/ens.ts` | ✅ created — exports `ensNameForSlug`, `decodeDnsName`, `textRecordFor`, `SUPPORTED_TEXT_KEYS`, `ENS_SIGNATURE_TTL_SECONDS` |

### API (`apps/api/`)

| File | Status |
|---|---|
| `src/routes/agents.ts` | ✅ added `ens_name` to `POST/GET /api/v1/agents/register` and `GET /api/v1/agents/me` responses; added `ens_subname_claimed_at` to `agentSelect` |
| `src/routes/ens.ts` | ✅ created — CCIP-Read GET/POST gateway for address, coinType 60, text, and contenthash lookups |
| `src/app.ts` | ✅ ensRoutes wired into Fastify; `maxParamLength` raised for long EIP-3668 URL calldata |
| `.env` | ✅ `apps/api/.env.example` documents `ENS_SIGNER_PRIVATE_KEY`; gateway still falls back to `ORGANIZER_PRIVATE_KEY` if needed |

### Docs (`docs/ens/`)

| File | Status |
|---|---|
| `track-a.md` | ✅ prize conditions, technology, why this design |
| `sepolia-implementation.md` | ✅ 7-phase architecture plan |
| `implementation-plan.md` | ✅ detailed actionable plan with all code |
| `status.md` | ✅ this file |

---

## What's Left

### 1. Deploy the API

The resolver contract was deployed pointing to `https://api.buildersclaw.xyz/api/v1/ens/{sender}/{data}.json`. Push the new code and redeploy whatever serves that domain.

Required API deployment env:

```bash
DATABASE_URL=...
ENS_SIGNER_PRIVATE_KEY=...
```

`ENS_SIGNER_PRIVATE_KEY` must correspond to an address authorized on the deployed `OffchainResolver`. For the hackathon deployment, that signer is `0x22735B9841F762e591A0d846faEDE3c8B39003dD`.

### 2. End-to-end verification

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com
UNIVERSAL=0xc8Af999e38273D658BE1b921b88A9Ddf005769cC

# Register a test agent with a known wallet first (or pick an existing agent)
# Then resolve via UniversalResolver (handles CCIP-Read transparently)

# DNS-encoded name for "myagent.agents.buildersclaw.eth"
DNS=0x076d796167656e74066167656e74730c6275696c64657273636c61770365746800
NODE=$(cast namehash myagent.agents.buildersclaw.eth)
INNER=$(cast calldata "addr(bytes32)" $NODE)

cast call --ccip-read $UNIVERSAL \
  "resolve(bytes,bytes)(bytes,address)" \
  $DNS $INNER \
  --rpc-url $RPC
# expected: bytes encoding the agent's wallet, plus resolver address
```

If this returns the wallet, the full chain works: ENS → resolver → revert → gateway → signed response → verified → returned.

UI demo: open [sepolia.app.ens.domains/myagent.agents.buildersclaw.eth](https://sepolia.app.ens.domains/myagent.agents.buildersclaw.eth).

---

## Completed Gateway Notes

The route handles two endpoints from EIP-3668:

```
GET  /api/v1/ens/:sender/:data        (URL form, with optional .json suffix)
POST /api/v1/ens                      (body form: { sender, data })
```

For each request:
1. Decode the outer `resolve(bytes name, bytes innerData)` calldata using viem's `decodeFunctionData`.
2. Decode the DNS-encoded `name` via `decodeDnsName` from `@buildersclaw/shared/ens`. Verify it ends in `.agents.buildersclaw.eth`.
3. Extract the slug (first label). Look up the agent: `db.select().from(agents).where(eq(agents.name, slug))`.
4. Decode `innerData`. Branch on function:
   - `addr(bytes32)` → return `agent.walletAddress` ABI-encoded as `address` (or `zeroAddress` if missing).
   - `addr(bytes32, uint256)` (multi-coin) → if `coinType == 60n`, return wallet bytes; otherwise empty bytes.
   - `text(bytes32, string)` → call `textRecordFor(agent, key)` from the shared helper, ABI-encode as `string`.
   - `contenthash(bytes32)` → return empty bytes `0x`.
5. Compute `expires = now + 300`. Build the EIP-3668 signature hash:
   ```
   keccak256(0x1900 || sender(20) || expires(8) || keccak256(callData) || keccak256(result))
   ```
   Sign with viem's `sign({ hash, privateKey })`. Pack `r || s || v` as 65 bytes.
6. Return `{ data: abi.encode(result, expires, signature) }`.
7. Side effect: if `agent.ensSubnameClaimedAt` is null, update it to now (fire-and-forget so we don't block the response).

Implementation is in `apps/api/src/routes/ens.ts` and follows `docs/ens/implementation-plan.md` Phase 4.

---

## How to Pick This Up Cleanly

1. **Don't redeploy the contract** unless you change the gateway URL or the signer set. The contract supports `setUrl(string)` and `addSigners/removeSigners(address[])` for live updates without redeploy.
2. **Signer key** — the contract was deployed with signer = `0x22735B9841F762e591A0d846faEDE3c8B39003dD` (the same as `ORGANIZER_PRIVATE_KEY`). Prefer setting `ENS_SIGNER_PRIVATE_KEY` on the API deployment; the gateway falls back to `ORGANIZER_PRIVATE_KEY` if needed.

---

## Risk Watchlist

| Risk | Status |
|---|---|
| Gateway URL placeholder substitution | ENS clients replace `{sender}` and `{data}` literally; Fastify route uses `:sender/:data` and strips `.json` suffix |
| Long CCIP-Read URL calldata | Fastify `maxParamLength` set to `8192`; local GET `.json` route test passes |
| DNS name decoding edge cases | `agents.name` is regex-validated as `[a-z0-9_]+` — ASCII-only, no UTF-8 hazards |
| Signature replay | `expires` enforced on-chain in `resolveWithProof` (5 min TTL) |
| Wrong signer in contract | Fixed at deploy: `0x22735B9841F762e591A0d846faEDE3c8B39003dD`. Verify with `cast call $RESOLVER "signers(address)(bool)" 0x227...` |
| Resolver URL has trailing path | Yes, includes `{sender}/{data}.json` — must be parsed with both URL form and POST form supported in Fastify route |

---

## Files Touched (for `git add`)

```
apps/contracts/src/ens/IExtendedResolver.sol           (new)
apps/contracts/src/ens/SignatureVerifier.sol           (new)
apps/contracts/src/ens/OffchainResolver.sol            (new)
apps/contracts/script/DeployEnsResolver.s.sol          (new)
apps/contracts/test/OffchainResolver.t.sol             (new)
apps/contracts/.env                                    (modified — appended ENS section)
apps/contracts/broadcast/DeployEnsResolver.s.sol/...   (new — Foundry artifact)
apps/contracts/cache/DeployEnsResolver.s.sol/...       (new — Foundry artifact)
apps/web/drizzle/0003_curved_blackheart.sql             (new)
apps/web/drizzle/meta/0003_snapshot.json                (new)
apps/web/drizzle/meta/_journal.json                     (modified)
packages/shared/src/db/schema.ts                       (modified — ensSubnameClaimedAt)
packages/shared/src/ens.ts                             (new)
apps/api/src/routes/agents.ts                          (modified — ens_name in responses)
docs/ens/track-a.md                                    (new)
docs/ens/sepolia-implementation.md                     (new)
docs/ens/implementation-plan.md                        (new)
docs/ens/status.md                                     (new — this file)
```

`apps/contracts/.env` and the `broadcast/`/`cache/` directories should follow the existing gitignore rules — verify before committing.
