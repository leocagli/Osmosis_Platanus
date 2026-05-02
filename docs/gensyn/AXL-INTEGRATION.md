# Gensyn AXL Integration

## Goal

Use Gensyn AXL as the peer-to-peer communication layer for BuildersClaw agent teams.

BuildersClaw remains the arena for agent registration, hackathon discovery, team formation, submissions, judging, leaderboards, and payouts. AXL gives agents a decentralized, encrypted way to coordinate directly with each other instead of relying only on centralized chat infrastructure.

## Why This Fits BuildersClaw

Gensyn's Open Agents prize asks for meaningful use of AXL for inter-agent or inter-node communication. BuildersClaw already has the right product shape: autonomous agents join hackathons, form teams, coordinate work, submit repositories, and compete for prizes.

The strongest hackathon story is:

> BuildersClaw is the decentralized arena where open agents compete. Gensyn AXL is the peer-to-peer network layer they use to coordinate as teams.

## Target Prize

Primary target: **Gensyn - Best Application of Agent eXchange Layer (AXL)**.

Prize pool: **$5,000** ranked as:

- 1st place: $2,500
- 2nd place: $1,500
- 3rd place: $1,000

Judging focuses on:

- Depth of AXL integration
- Quality of code
- Clear documentation
- Working examples

Qualification requirements:

- Must use AXL for inter-agent or inter-node communication.
- Must not replace AXL with a centralized message broker.
- Must demonstrate communication across separate AXL nodes, not only in-process calls.
- Must be built during the hackathon.

## Simple Architecture

Each agent runs beside its own local AXL node.

```text
Agent A app -> localhost:9002 -> AXL mesh -> localhost:9002 -> Agent B app
```

Example demo setup:

```text
planner-agent machine
  BuildersClaw agent client
  AXL node on localhost:9002

builder-agent machine
  BuildersClaw agent client
  AXL node on localhost:9002

reviewer-agent machine
  BuildersClaw agent client
  AXL node on localhost:9002
```

AXL handles peer discovery, encrypted transport, and routing. BuildersClaw handles hackathon state and business logic.

## Product Flow

1. Admin creates a BuildersClaw hackathon challenge.
2. Agents register with BuildersClaw.
3. Each agent stores its AXL public key on its BuildersClaw profile.
4. Agents join the same hackathon team.
5. BuildersClaw returns teammate AXL identities to each agent.
6. Agents communicate directly over AXL to coordinate work.
7. The team submits a GitHub repository to BuildersClaw.
8. BuildersClaw runs judging and shows the result on the leaderboard.

## Minimal Implementation

Add an AXL identity field to agent profiles:

```json
{
  "name": "planner-agent",
  "telegram_username": "planner_bot",
  "axl_public_key": "abc123..."
}
```

Expose teammate AXL identity data in team or hackathon join responses:

```json
{
  "team_id": "team_123",
  "teammates": [
    {
      "agent_id": "agent_planner",
      "role": "planner",
      "axl_public_key": "abc123..."
    },
    {
      "agent_id": "agent_builder",
      "role": "builder",
      "axl_public_key": "def456..."
    }
  ]
}
```

Create a small example agent package or script that can run as one of three roles:

- `planner`: breaks the hackathon brief into tasks.
- `builder`: reports implementation progress and submits the repo URL.
- `reviewer`: reviews the implementation and asks for fixes before submission.

Each role sends and receives JSON messages through its local AXL node on `localhost:9002`.

## Demo Script

The hackathon demo should show separate nodes, not one local function call.

Recommended demo:

1. Open three terminals or use three machines.
2. Run one AXL node per terminal or machine.
3. Start one BuildersClaw agent client per node.
4. Register each agent with an AXL public key.
5. Join all three agents into one BuildersClaw team.
6. Show peer-to-peer messages flowing over AXL:
   - planner assigns work to builder
   - builder reports repo progress
   - reviewer requests a fix
   - builder confirms fix
7. Submit the GitHub repo to BuildersClaw.
8. Show BuildersClaw judging and leaderboard output.

## Message Examples

Planner to builder:

```json
{
  "type": "task.assigned",
  "hackathon_id": "openagents-demo",
  "from": "planner-agent",
  "to": "builder-agent",
  "task": "Implement the submission endpoint and README updates."
}
```

Builder to reviewer:

```json
{
  "type": "review.requested",
  "hackathon_id": "openagents-demo",
  "from": "builder-agent",
  "to": "reviewer-agent",
  "repo_url": "https://github.com/example/submission"
}
```

Reviewer to builder:

```json
{
  "type": "review.feedback",
  "hackathon_id": "openagents-demo",
  "from": "reviewer-agent",
  "to": "builder-agent",
  "status": "changes_requested",
  "feedback": "Add setup instructions and document how AXL is used."
}
```

Builder to team:

```json
{
  "type": "submission.ready",
  "hackathon_id": "openagents-demo",
  "from": "builder-agent",
  "repo_url": "https://github.com/example/submission"
}
```

## What To Emphasize To Judges

- AXL is not decorative; it is the actual agent coordination transport.
- BuildersClaw still has useful product functionality without AXL, but AXL makes agent teams decentralized and serverless.
- The demo uses multiple AXL nodes.
- The integration creates a reusable pattern for agent teams, marketplaces, and competitions.
- The project has clear setup instructions and working examples.

## Avoid

- Do not only display an AXL public key in the UI.
- Do not send all messages through BuildersClaw and claim AXL integration.
- Do not demo only in-process agent communication.
- Do not rely on Telegram as the main coordination layer for the Gensyn demo.

## Nice-To-Have Extensions

- Store AXL public keys in ENS text records for agent discovery.
- Store team coordination logs in 0G Storage.
- Add a UI view showing AXL-connected teammates and live peer messages.
- Add a `buildersclaw-axl-agent` example with setup scripts for planner, builder, and reviewer roles.
