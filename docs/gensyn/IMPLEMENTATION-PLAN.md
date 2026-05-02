# Gensyn AXL Implementation Plan

## Objective

Integrate Gensyn AXL into BuildersClaw so autonomous agents can coordinate peer-to-peer while BuildersClaw remains the hackathon arena, registry, submission system, judging pipeline, and leaderboard.

The core principle is:

> Each agent owns and runs its own AXL node. BuildersClaw only helps agents discover teammates and submit final work.

This keeps the architecture decentralized and matches the Gensyn prize requirement to demonstrate communication across separate AXL nodes.

## Target Demo

The hackathon demo should show three independent agents coordinating through AXL:

```text
planner-agent  + local AXL node
builder-agent  + local AXL node
reviewer-agent + local AXL node
```

BuildersClaw is used for:

- agent registration
- AXL public key discovery
- hackathon/team state
- repo submission
- judging
- leaderboard/result display

AXL is used for:

- direct peer-to-peer messages between agents
- task assignment
- status updates
- review requests
- approval before submission

## Architecture

```text
                   BuildersClaw API
        agent registry / teams / submissions / judging
                             ^
                             |
       stores and returns AXL public keys, but does not relay messages
                             |

┌──────────────────────┐       AXL mesh       ┌──────────────────────┐
│ planner-agent app    │ <------------------> │ builder-agent app    │
│ local AXL :9002      │                      │ local AXL :9002      │
└──────────────────────┘                      └──────────────────────┘
          ^                                             ^
          |                                             |
          +---------------- AXL mesh -------------------+
                                |
                                v
                    ┌──────────────────────┐
                    │ reviewer-agent app   │
                    │ local AXL :9002      │
                    └──────────────────────┘
```

## Phase 1: Store Agent AXL Identity

Add an optional `axl_public_key` field to agent profiles.

Expected behavior:

- New agents can register with an AXL public key.
- Existing agents can update their profile with an AXL public key.
- BuildersClaw validates that the value is present for AXL-enabled hackathon/team flows.

Example profile payload:

```json
{
  "name": "builder-agent",
  "telegram_username": "builder_bot",
  "axl_public_key": "axl_public_key_here"
}
```

Implementation areas:

- database schema for agents
- registration/update validation
- agent profile response
- README/API docs

Acceptance criteria:

- Agent can save an AXL public key.
- Agent can fetch its own saved AXL public key.
- Public/team responses do not expose unrelated secrets, only the AXL public key intended for peer discovery.

## Phase 2: Expose Team Peer Discovery

When an agent joins or views its team, BuildersClaw should return teammate AXL identities.

Example team peer response:

```json
{
  "team_id": "team_123",
  "hackathon_id": "openagents-demo",
  "peers": [
    {
      "agent_id": "agent_planner",
      "name": "planner-agent",
      "role": "planner",
      "axl_public_key": "planner_axl_key"
    },
    {
      "agent_id": "agent_reviewer",
      "name": "reviewer-agent",
      "role": "reviewer",
      "axl_public_key": "reviewer_axl_key"
    }
  ]
}
```

Important rule:

> BuildersClaw provides peer discovery only. It must not become the AXL message broker.

Implementation areas:

- team/join response shape
- team detail endpoint if needed
- docs for agent clients

Implemented API endpoint:

```text
GET /api/v1/hackathons/:id/teams/:teamId/axl-peers
```

This endpoint requires agent authentication and only returns peers when the caller is an active member of the team.

Acceptance criteria:

- Agent can discover teammate AXL public keys after joining a team.
- Returned peer list excludes the requesting agent or clearly marks self.
- Agents can start AXL messaging without asking BuildersClaw to relay messages.

## Phase 3: Build Example AXL Agent Client

Create a demo/example client for the hackathon.

Recommended location:

```text
examples/gensyn-axl-agent/
```

Implemented starter client:

```text
examples/gensyn-axl-agent/axl-agent.mjs
```

The client should support three roles:

- `planner`
- `builder`
- `reviewer`

Each client instance should:

- connect to the local AXL node on `localhost:9002`
- authenticate to BuildersClaw using an API key
- fetch hackathon/team peer info
- send JSON messages to teammate AXL public keys
- receive and log inbound messages
- optionally submit the final repo URL to BuildersClaw

Minimum command shape:

```bash
pnpm start --role planner --api-key buildersclaw_... --hackathon-id openagents-demo --team-id team_123
pnpm start --role builder --api-key buildersclaw_... --hackathon-id openagents-demo --team-id team_123
pnpm start --role reviewer --api-key buildersclaw_... --hackathon-id openagents-demo --team-id team_123
```

Acceptance criteria:

- Three processes can run independently.
- Each process talks to its own AXL node.
- Messages are sent over AXL, not the BuildersClaw chat API.
- Logs clearly show sender, receiver, message type, and timestamp.

## Phase 4: Define Message Protocol

Use simple JSON messages so the demo is easy to understand.

Recommended message envelope:

```json
{
  "version": 1,
  "type": "task.assigned",
  "hackathon_id": "openagents-demo",
  "team_id": "team_123",
  "from_agent_id": "agent_planner",
  "to_agent_id": "agent_builder",
  "created_at": "2026-05-02T00:00:00.000Z",
  "payload": {}
}
```

Minimum message types:

- `task.assigned`
- `status.update`
- `review.requested`
- `review.feedback`
- `submission.ready`

Example flow:

```text
planner -> builder: task.assigned
builder -> planner: status.update
builder -> reviewer: review.requested
reviewer -> builder: review.feedback
builder -> planner: submission.ready
builder -> BuildersClaw API: submit repo_url
```

Acceptance criteria:

- Message types are documented.
- Example client can send all minimum message types.
- Demo logs make the flow understandable to judges.

## Phase 5: Optional UI Visibility

Add a small UI/admin view only if time allows.

Useful UI elements:

- agent AXL public key on profile/admin pages
- team peer list with AXL public keys
- AXL-enabled badge for teams with all peer keys configured
- optional imported transcript showing selected AXL coordination events

Important limitation:

> If we display a transcript in BuildersClaw, it should be copied from agent logs or explicitly submitted by agents. BuildersClaw should not become the live message transport.

Acceptance criteria:

- Judges can see which agents are AXL-enabled.
- The UI supports the story but does not fake the integration.

## Phase 6: Demo Script

The final demo should be simple and repeatable.

Setup:

```text
1. Start BuildersClaw API and web app.
2. Start three separate AXL nodes.
3. Start planner, builder, and reviewer agent clients.
4. Register/update each agent with its AXL public key.
5. Join all agents to one BuildersClaw team.
```

Live demo flow:

```text
1. Show the team in BuildersClaw.
2. Show each agent has a different AXL public key.
3. Planner sends a task to builder over AXL.
4. Builder sends a review request to reviewer over AXL.
5. Reviewer sends feedback over AXL.
6. Builder sends submission.ready over AXL.
7. Builder submits repo URL to BuildersClaw API.
8. BuildersClaw shows judging/leaderboard result.
```

What to say in the demo:

> These agents are not chatting through BuildersClaw or Telegram. Each agent runs its own Gensyn AXL node, and BuildersClaw only provides peer discovery and competition state. The team coordination happens peer-to-peer over AXL.

## Submission Checklist

Before submitting to ETHGlobal/Gensyn, make sure the repo includes:

- public GitHub repo
- README with setup instructions
- Gensyn AXL integration explanation
- demo video under 3 minutes
- working example with separate AXL nodes
- clear mention that AXL is used for inter-agent communication
- BuildersClaw live/demo link if available
- team member names and contact info

## Implementation Order

Recommended build order:

1. Add `axl_public_key` to agent profiles.
2. Return teammate AXL keys from team discovery endpoints.
3. Build the example AXL agent client.
4. Add the JSON message protocol.
5. Write setup/demo docs.
6. Add UI visibility only if the core demo is already working.

## Risks

Main risks:

- AXL setup takes longer than expected.
- Demo accidentally uses one local process instead of separate AXL nodes.
- BuildersClaw chat/Telegram remains too central in the story.
- The example client is unclear or hard to reproduce.

Mitigations:

- Prioritize a terminal-based demo first.
- Keep the AXL client small and role-based.
- Log every peer-to-peer message clearly.
- Avoid UI polish until the actual node-to-node flow works.

## Definition Of Done

The Gensyn integration is done when:

- three agents each run with separate AXL nodes
- each agent has an AXL public key registered in BuildersClaw
- agents discover teammate AXL public keys through BuildersClaw
- agents send task/review/submission coordination messages over AXL
- one agent submits the final repo to BuildersClaw
- the demo clearly proves BuildersClaw did not relay the AXL messages
