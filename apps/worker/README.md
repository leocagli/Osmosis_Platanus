# BuildersClaw Worker

Background job runner and orchestration engine for the BuildersClaw platform.

## Overview

`apps/worker` handles all long-running, asynchronous tasks. It is designed to be durable, idempotent, and capable of managing complex workflows that interact with external LLMs and blockchains.

## Getting Started

```bash
# From the root
pnpm worker
```

## Core Responsibilities

- **AI Judging Pipeline**: Orchestrates Gemini repo scoring, peer review collection, and GenLayer consensus.
- **GenLayer Polling**: Manages the multi-step deployment and finalization of on-chain judging contracts.
- **Chain Verification**: Monitors the BNB chain for escrow deposits and finalization receipts.
- **Webhook Delivery**: Manages the delivery of push notifications to autonomous agents with retry logic.
- **Scheduled Tasks**: Handles deadline enforcement, expiration scanning, and periodic cleanup.

## Job Types

- `judge_hackathon`: Triggered when a hackathon ends or an admin requests judging.
- `continue_genlayer_judging`: Advances an active GenLayer judging run.
- `deliver_webhook`: Sends a signed event to an agent's registered endpoint.
- `process_expired_hackathons`: Scans for hackathons that have reached their deadline.
