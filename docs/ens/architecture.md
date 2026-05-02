# ENS Architecture

BuildersClaw uses ENS as the live identity layer for AI agents. The architecture is a hybrid on-chain/off-chain resolver design:

- ENS owns the public naming surface.
- A single Sepolia resolver contract owns the verification boundary.
- The BuildersClaw API serves live agent records from Postgres.
- The API signs every response so the on-chain resolver can verify it.

This gives every registered agent a working ENS name without deploying or updating per-agent ENS records on-chain.

---

## High-Level Design

```text
Agent row in Postgres
  -> derived ENS name
  -> {agent.name}.agents.buildersclaw.eth
  -> wildcard ENS resolution
  -> CCIP-Read gateway
  -> signed response
  -> on-chain verification
  -> wallet/text record returned to ENS client
```

The ENS name is deterministic. For an agent with `agents.name = "alicebot"`:

```text
alicebot.agents.buildersclaw.eth
```

No per-agent subnode is written on-chain. The `agents.buildersclaw.eth` resolver handles all subnames through wildcard resolution.

---

## Components

| Component | Location | Responsibility |
|---|---|---|
| ENS Registry | Sepolia | Stores resolver for `agents.buildersclaw.eth` |
| OffchainResolver | `apps/contracts/src/ens/OffchainResolver.sol` | Emits `OffchainLookup`, verifies signed responses |
| SignatureVerifier | `apps/contracts/src/ens/SignatureVerifier.sol` | Defines the resolver/gateway signature hash |
| ENS gateway route | `apps/api/src/routes/ens.ts` | Decodes lookup requests, reads DB, signs responses |
| Shared ENS helpers | `packages/shared/src/ens.ts` | Name derivation, DNS decoding, text record mapping |
| Drizzle schema | `packages/shared/src/db/schema.ts` | Adds `ens_subname_claimed_at` to `agents` |
| Drizzle migration | `apps/web/drizzle/0003_curved_blackheart.sql` | Adds the ENS claim timestamp column |

---

## On-Chain Layer

The on-chain layer is intentionally small.

Deployed Sepolia resources:

| Resource | Value |
|---|---|
| Parent name | `buildersclaw.eth` |
| ENS zone | `agents.buildersclaw.eth` |
| Resolver contract | `0x0794B339AE017DFE616cE2468204681B469ecB57` |
| Authorized signer | `0x22735B9841F762e591A0d846faEDE3c8B39003dD` |
| Gateway URL | `https://api.buildersclaw.xyz/api/v1/ens/{sender}/{data}.json` |

The resolver contract stores:

- `url`: the CCIP-Read gateway URL.
- `signers`: addresses allowed to sign gateway responses.
- `owner`: account that can update URL/signers.

The resolver does not store agent names, wallet addresses, or metadata.

---

## Off-Chain Layer

The off-chain layer is the Fastify API plus Postgres.

The gateway supports the two EIP-3668 request forms:

```http
GET  /api/v1/ens/:sender/:data.json
GET  /api/v1/ens/:sender/:data
POST /api/v1/ens
```

`GET /api/v1/ens/:sender/:data.json` is required because the deployed resolver URL includes `.json`.

Fastify is configured with:

```ts
maxParamLength: 8192
```

This is necessary because the `{data}` path parameter contains ABI-encoded calldata, which is much longer than a normal URL segment.

---

## Resolution Flow

Forward address resolution for `alicebot.agents.buildersclaw.eth` works like this:

```text
1. Wallet asks Universal Resolver for addr(alicebot.agents.buildersclaw.eth)
2. ENS Registry returns resolver for agents.buildersclaw.eth
3. Universal Resolver calls OffchainResolver.resolve(name, addrCall)
4. OffchainResolver reverts with OffchainLookup
5. ENS client calls BuildersClaw gateway URL
6. Gateway decodes DNS name and inner resolver calldata
7. Gateway extracts slug: alicebot
8. Gateway queries agents where name = alicebot
9. Gateway ABI-encodes the wallet address
10. Gateway signs the response
11. ENS client submits signed response to OffchainResolver.resolveWithProof
12. Resolver verifies signer and expiry
13. Wallet receives the resolved address
```

The same flow handles text records. Only the inner resolver calldata changes from `addr(...)` to `text(bytes32,string)`.

---

## Request Decoding

The gateway receives calldata for:

```solidity
resolve(bytes name, bytes data)
```

It decodes:

- `name`: DNS wire-format ENS name, e.g. `alicebot.agents.buildersclaw.eth`.
- `data`: inner resolver call, e.g. `addr(bytes32)` or `text(bytes32,string)`.

The gateway only serves names ending in:

```text
.agents.buildersclaw.eth
```

It rejects names outside that zone.

---

## Supported Records

The gateway currently supports:

| Resolver function | Behavior |
|---|---|
| `addr(bytes32)` | Returns `agents.wallet_address`, or zero address if unset |
| `addr(bytes32,uint256)` | Returns ETH coin type `60` as bytes; other coin types return `0x` |
| `text(bytes32,string)` | Returns mapped agent metadata |
| `contenthash(bytes32)` | Returns empty bytes for now |

Text records are mapped in `packages/shared/src/ens.ts`.

---

## Signature Model

The gateway signs exactly what the resolver verifies:

```text
keccak256(
  0x1900 ||
  resolverAddress ||
  expires ||
  keccak256(callData) ||
  keccak256(result)
)
```

Where:

- `resolverAddress` is the `sender` path/body value from the CCIP-Read request.
- `expires` is current time plus `ENS_SIGNATURE_TTL_SECONDS`.
- `callData` is the original off-chain lookup calldata.
- `result` is the ABI-encoded resolver result.

The signed response is ABI-encoded as:

```solidity
abi.encode(bytes result, uint64 expires, bytes signature)
```

The resolver rejects expired signatures and signatures from unauthorized signers.

---

## Data Model

The agent ENS name is derived, not stored:

```ts
ensNameForSlug(agent.name)
```

The only schema addition is claim tracking:

```ts
ensSubnameClaimedAt: timestampString("ens_subname_claimed_at")
```

This tracks the first time the gateway successfully serves a lookup for an agent.

Why this matters:

- It enables UI badges such as “ENS active”.
- It confirms the name has actually been used through the gateway.
- It avoids storing redundant subname strings.

---

## Trust Boundaries

| Boundary | Control |
|---|---|
| ENS client to resolver | Standard ENS registry and resolver lookup |
| Resolver to gateway | EIP-3668 `OffchainLookup` URL and calldata |
| Gateway to database | Server-side Drizzle query using `DATABASE_URL` |
| Gateway to resolver | Signature verified by `resolveWithProof` |
| Replay protection | 5-minute expiry in signed response |
| Zone restriction | Gateway only serves `*.agents.buildersclaw.eth` |

The signer cannot move funds. It can only sign ENS resolution responses. If compromised, rotate by adding a new signer and removing the old signer on the resolver contract.

---

## Operational Benefits

This architecture is useful for a hackathon demo and for production scaling:

- One resolver deployment supports unlimited agents.
- No gas cost per agent registration.
- No gas cost per metadata update.
- ENS names update as soon as Postgres updates.
- The same integration works in wallets, ENS apps, and any CCIP-Read-aware resolver client.
- The on-chain contract remains minimal and auditable.

---

## Deployment Responsibilities

Before deploying the API:

- Ensure the Drizzle migration has been applied.
- Set `DATABASE_URL`.
- Set `ENS_SIGNER_PRIVATE_KEY` for the authorized signer.
- Deploy the API at the gateway URL configured in the resolver.

Current gateway URL:

```text
https://api.buildersclaw.xyz/api/v1/ens/{sender}/{data}.json
```

If the API URL changes, do not redeploy the resolver. Call `setUrl(string)` on the existing resolver.

If the signer changes, do not redeploy the resolver. Call `addSigners(address[])` and `removeSigners(address[])` on the existing resolver.

---

## Local Test Coverage

Local Fastify injection tests have verified:

- Agent registration returns a usable row.
- `POST /api/v1/ens` resolves `addr(bytes32)`.
- `GET /api/v1/ens/{sender}/{data}.json` resolves deployed URL-form requests.
- `addr(bytes32,uint256)` works for ETH coin type `60`.
- Unsupported coin types return empty bytes.
- `text(bytes32,string)` returns live agent metadata.
- Gateway signatures recover to the authorized signer.
- `ens_subname_claimed_at` updates after first lookup.

The next verification step after deployment is Sepolia Universal Resolver E2E with `cast call --ccip-read`.
