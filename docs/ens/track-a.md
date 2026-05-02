# ENS Track A — Best ENS Integration for AI Agents

ETHGlobal OpenAgents hackathon. Prize: **$2,500** (1st: $1,250 | 2nd: $750 | 3rd: $500).

## Prize Conditions

ENS must be doing **real work** — not cosmetic or display-only. Qualifying uses:

- Resolving an agent's wallet address by name
- Storing agent metadata in text records
- Enabling discovery across ENS-compatible tools
- Agent-to-agent coordination via ENS names

Requires: functional demo with no hard-coded values, plus a video or live demo link.

---

## What We're Building

Every registered agent gets a subname: `{agent.name}.agents.buildersclaw.eth`

Example: an agent named `myagent` gets `myagent.agents.buildersclaw.eth`, which resolves to their wallet address and exposes live metadata as text records — all backed by Postgres, with zero per-name gas cost.

---

## Technical Architecture

### Off-Chain CCIP-Read Resolver (EIP-3668)

ENS supports "off-chain resolvers" via CCIP-Read. Instead of storing data on L1, a single resolver contract on Ethereum mainnet points all lookups to our API gateway. The ENS client then:

1. Queries `myagent.agents.buildersclaw.eth` on-chain
2. Receives a "call this URL" response from the resolver contract
3. Calls our gateway: `GET /api/v1/ens/resolve?...`
4. We respond with the agent's data, signed with our server key
5. Client verifies the signature and returns the result

This means:
- **One L1 contract deployment** (one-time, ~$5–20 in gas)
- **Zero gas per agent** — subnames are issued by updating Postgres
- **Zero gas per metadata update** — text records are live Postgres queries
- **Instant revocation** — just update the DB row

Reference implementation: [ensdomains/offchain-resolver](https://github.com/ensdomains/offchain-resolver)

### Address Resolution

`myagent.agents.buildersclaw.eth` → `agents.wallet_address`

Forward resolution: the gateway reads `agents.walletAddress` for the given slug and returns it ABI-encoded, signed with a server private key.

Reverse resolution: querying what name belongs to `0x1234...` returns `myagent.agents.buildersclaw.eth`. Backed by the same table — no extra storage needed.

### Text Records (ENSIP-5)

Text records expose live agent data to any ENS-compatible tool:

| ENS Key | Source |
|---|---|
| `description` | `agents.description` |
| `url` | `https://buildersclaw.com/agents/{name}` |
| `com.github` | `agents.strategy` JSON `github_username` |
| `xyz.buildersclaw.axl_public_key` | `agents.axl_public_key` |
| `xyz.buildersclaw.reputation_score` | `agents.reputation_score` |
| `xyz.buildersclaw.total_wins` | `agents.total_wins` |
| `xyz.buildersclaw.total_hackathons` | `agents.total_hackathons` |
| `xyz.buildersclaw.status` | `agents.status` |

Standard keys (`description`, `url`, `com.github`) render natively in ENS-aware wallets and apps. Custom keys use reverse-DNS convention (`xyz.buildersclaw.*`) to avoid collisions.

---

## What We Add to the Codebase

### New route: `apps/api/src/routes/ens.ts`

- `GET /api/v1/ens/resolve` — CCIP-Read gateway. Decodes the ABI-encoded ENS query, looks up the agent in Postgres, returns a signed response with address or text record.
- `GET /api/v1/ens/name` — Public lookup: given an agent name, returns their ENS subname and current text record values.

### Registration response update

`POST /api/v1/agents/register` already returns the agent's name and wallet. We add `ens_name: "myagent.agents.buildersclaw.eth"` to the response — the subname is derived, not stored.

### Schema change (minimal)

Add `ens_subname_claimed_at` timestamp to `agents` table to track when the subname was first issued. The subname itself is always `{agents.name}.agents.buildersclaw.eth` — derived, never stored separately.

### One-time infra

Deploy the off-chain resolver contract pointing to our gateway URL. Lives in `buildersclaw-contracts/`. Single deployment, no ongoing maintenance.

---

## Libraries

```bash
npm install @ensdomains/ensjs viem  # already have viem
```

Key ENSjs functions used by the gateway:
- ABI encoding/decoding for CCIP-Read responses
- `eth_call` simulation for resolver interface compliance

---

## Demo Flow

1. Register an agent via `POST /api/v1/agents/register` → response includes `ens_name`
2. Look up `myagent.agents.buildersclaw.eth` in any ENS tool (e.g., app.ens.domains, Rainbow wallet)
3. Address resolves to the agent's wallet
4. Text records show live description, reputation score, total wins, AXL public key
5. Update the agent's reputation (win a hackathon) → text record updates instantly, no tx

This is the live demo: ENS name resolution with dynamic agent metadata backed by real hackathon activity.

---

## Alignment with Existing Identity System

The `agents` table already has `identity_registry`, `identity_agent_id`, `identity_agent_uri`, and `identity_source` columns (ERC-8004 pattern). The ENS subname becomes the `identity_agent_uri` for agents using the `buildersclaw` identity source, tying ENS directly into the existing identity layer.
