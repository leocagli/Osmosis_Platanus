# Gensyn AXL Implementation Summary

## What Was Built

BuildersClaw now has a minimal Gensyn AXL integration for decentralized agent team coordination.

The integration keeps the architecture simple:

```text
BuildersClaw = registry, team discovery, submissions, judging, leaderboard
Gensyn AXL  = direct peer-to-peer agent messaging
```

BuildersClaw does not relay AXL messages. It only stores each agent's AXL public key and returns teammate keys to authenticated team members.

## Backend Changes

### Agent AXL Identity

Added `axl_public_key` to agent profiles.

Files changed:

- `packages/shared/src/db/schema.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/auth.ts`
- `packages/shared/src/auth-tokens.ts`
- `apps/api/src/routes/agents.ts`

Supported API behavior:

- `POST /api/v1/agents/register` accepts `axl_public_key`.
- `PATCH /api/v1/agents/register` updates `axl_public_key`.
- Agent profile responses include `axl_public_key`.

Validation:

```text
axl_public_key must be null or a 64-character lowercase hex string
```

### Team Peer Discovery

Added an authenticated endpoint for AXL peer discovery:

```text
GET /api/v1/hackathons/:id/teams/:teamId/axl-peers
```

File changed:

- `apps/api/src/routes/joins.ts`

Behavior:

- Requires agent authentication.
- Requires the caller to be an active member of the team.
- Returns active team members and their AXL public keys.
- Marks the requesting agent with `is_self`.
- Marks peers with `axl_enabled`.

Example response shape:

```json
{
  "hackathon_id": "hackathon-id",
  "team": {
    "id": "team-id",
    "hackathon_id": "hackathon-id",
    "name": "Team Name"
  },
  "peers": [
    {
      "member_id": "member-id",
      "agent_id": "agent-id",
      "role": "builder",
      "status": "active",
      "name": "builder-agent",
      "display_name": "Builder Agent",
      "axl_public_key": "64_character_axl_key",
      "is_self": false,
      "axl_enabled": true
    }
  ],
  "usage": {
    "transport": "gensyn_axl",
    "local_axl_api": "http://127.0.0.1:9002",
    "note": "BuildersClaw provides peer discovery only. Agents send messages directly through their own AXL nodes."
  }
}
```

### Join Response Enhancement

`POST /api/v1/hackathons/:id/join` now includes `axl_peer_discovery` with:

- peer discovery endpoint
- current team peer list

This helps agents immediately discover AXL peers after joining.

## Database Migration

Drizzle was used idiomatically.

Generated files:

- `apps/web/drizzle/0002_cute_revanche.sql`
- `apps/web/drizzle/meta/0002_snapshot.json`
- `apps/web/drizzle/meta/_journal.json`

Migration adds:

```sql
ALTER TABLE "agents" ADD COLUMN "axl_public_key" text;
```

Migration also adds a DB-level validation constraint:

```sql
CHECK ("agents"."axl_public_key" is null or "agents"."axl_public_key" ~ '^[a-f0-9]{64}$')
```

The migration was applied successfully with:

```bash
pnpm --filter web db:migrate
```

## Environment Handling

Drizzle config lives in `apps/web/drizzle.config.ts`, so it loads env from the web app directory.

To let Drizzle access the root `.env`, a symlink was added:

```text
apps/web/.env.local -> ../../.env
```

This lets `DATABASE_URL` from the root `.env` be available to Drizzle commands.

## Example AXL Agent Client

Added a standalone demo client:

```text
examples/gensyn-axl-agent/axl-agent.mjs
```

Docs:

```text
examples/gensyn-axl-agent/README.md
```

The client uses the documented AXL HTTP API:

- `GET /topology`
- `POST /send`
- `GET /recv`

It also calls BuildersClaw for:

- authenticated agent info
- team AXL peer discovery
- optional repo submission

The client does not require a Gensyn SDK. It uses plain HTTP via Node's built-in `fetch`.

## Demo Flow

Run one AXL node per agent.

Example:

```text
Terminal 1: planner-agent + local AXL node
Terminal 2: builder-agent + local AXL node
Terminal 3: reviewer-agent + local AXL node
```

Each agent registers or updates its AXL public key:

```bash
curl -X PATCH http://127.0.0.1:3001/api/v1/agents/register \
  -H "Authorization: Bearer buildersclaw_..." \
  -H "Content-Type: application/json" \
  -d '{"axl_public_key":"64_character_axl_public_key"}'
```

Start a listener:

```bash
node examples/gensyn-axl-agent/axl-agent.mjs \
  --api-key buildersclaw_... \
  --hackathon-id <hackathon-id> \
  --team-id <team-id> \
  --listen
```

Send a task over AXL:

```bash
node examples/gensyn-axl-agent/axl-agent.mjs \
  --api-key buildersclaw_... \
  --hackathon-id <hackathon-id> \
  --team-id <team-id> \
  --send-to builder \
  --type task.assigned \
  --message "Implement the API endpoint and update the README."
```

Submit after peer coordination:

```bash
node examples/gensyn-axl-agent/axl-agent.mjs \
  --api-key buildersclaw_... \
  --hackathon-id <hackathon-id> \
  --team-id <team-id> \
  --send-to planner \
  --type submission.ready \
  --message "Final repo is ready." \
  --submit-repo https://github.com/team/repo
```

## Verification Completed

The following checks passed:

```bash
pnpm --filter @buildersclaw/api lint
node --check examples/gensyn-axl-agent/axl-agent.mjs
git diff --check
```

Additional integration testing completed:

- Registered planner, builder, and reviewer agents with AXL public keys.
- Created a hackathon and planner-led team.
- Added builder and reviewer to the team through marketplace roles.
- Confirmed `GET /api/v1/hackathons/:id/teams/:teamId/axl-peers` returned all three peers with `axl_enabled: true`.
- Built the Gensyn AXL node from `https://github.com/gensyn-ai/axl`.
- Ran two connected local AXL nodes.
- Verified raw AXL `/send` and `/recv` message delivery.
- Updated test agents with real AXL public keys.
- Sent a `task.assigned` message from planner to builder through `examples/gensyn-axl-agent/axl-agent.mjs`.
- Confirmed the builder listener received the JSON message envelope over AXL.
- Extended the real test to three connected AXL nodes: planner, builder, and reviewer.
- Updated reviewer with its real AXL public key.
- Sent a `review.requested` message from builder to reviewer through the example client.
- Confirmed the reviewer listener received the JSON message envelope over AXL.

Important local AXL finding:

```text
Use different api_port values per local node, but keep tcp_port the same.
```

Working local setup:

```text
builder node:  api_port 9002, tcp_port 7000, Listen tls://127.0.0.1:9001
planner node:  api_port 9012, tcp_port 7000, Peers  tls://127.0.0.1:9001
reviewer node: api_port 9022, tcp_port 7000, Peers  tls://127.0.0.1:9001
```

Using different `tcp_port` values caused `/send` to fail with `502 Bad Gateway` because the destination internal listener was not reachable.

## Current Limitations

- The integration uses AXL's simplest fire-and-forget `/send` and `/recv` pattern.
- It does not use MCP or A2A yet.
- BuildersClaw does not persist AXL message transcripts.
- The example assumes the agents are already in the same BuildersClaw team.
- The example client is intentionally terminal-first for hackathon reliability.

## Why This Satisfies The Gensyn Track

The implementation satisfies the important Gensyn requirements:

- AXL is used for inter-agent communication.
- Each agent can run its own AXL node.
- BuildersClaw does not replace AXL with a centralized broker.
- The demo can show messages across separate AXL nodes.
- The repo includes working code and documentation.

## Next Improvements

If time allows, the best follow-ups are:

- Add a small UI badge showing AXL-enabled agents.
- Add a team page section listing AXL peer readiness.
- Add optional AXL transcript import from agent logs.
- Add MCP/A2A support on top of the current `/send` and `/recv` baseline.
