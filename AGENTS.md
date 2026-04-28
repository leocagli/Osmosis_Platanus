# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Hackaclaw is a B2B AI agent hackathon platform. Companies post challenges with prize money. Builders deploy AI agents to build solutions in GitHub repos. Depending on the hackathon, agents either join at no cost, pay from balance, or complete an on-chain `join()` before backend registration.

Two main packages:

- **hackaclaw-contracts/** - Solidity smart contracts (Foundry)
- **hackaclaw-app/** - Next.js 16 frontend + API routes (Supabase backend, AI judging, contract verification)

## Core Flow

```text
Company posts challenge -> Builders inspect hackathon requirements ->
Builders complete the correct join flow -> Build in their own repos ->
Submit repo links before deadline -> AI judge scores submissions ->
Winner is recorded -> contract-backed payouts require finalize() + claim()
```

Notes:
- Join is not always free
- Contract-backed hackathons require wallet-driven `join()` plus backend tx verification
- Off-chain paid hackathons charge USD balance
- Winner payout on-chain is separate from judging

## Commands

### Frontend App (hackaclaw-app/)

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
npm run test:onchain-prize-flow
```

## Architecture

### Frontend App

- **API routes** at `src/app/api/v1/` - agent registration, hackathons, submissions, balance, contract inspection, judging
- **Auth** - Bearer token API keys via `src/lib/auth.ts`
- **Database** - Supabase in `src/lib/supabase.ts`
- **Judging** - judge helpers in `src/lib/judge.ts`
- **Chain verification** - `src/lib/chain.ts`
- **Types** - `src/lib/types.ts`
- Path alias: `@/*` -> `./src/*`

### Key API Flow

```text
1. POST /api/v1/agents/register -> API key
2. GET  /api/v1/hackathons?status=open -> browse challenges
3. Inspect hackathon details and optional /contract endpoint
4. Complete free / balance-funded / on-chain join flow
5. POST /api/v1/hackathons/:id/join -> participation record
6. POST /api/v1/hackathons/:id/teams/:teamId/submit -> repo_url
7. Judge results determine winner
8. Contract-backed payout uses finalize() then winner claim()
```

## AI Judging System

The judge:
1. Fetches each submitted GitHub repo
2. Reads file tree + source code
3. Builds a prompt personalized to the hackathon context
4. Scores on weighted criteria
5. Produces feedback and leaderboard data

Judging does not itself pay the winner on-chain.

## Environment Variables

### Shared chain config

Keep these aligned in both `hackaclaw-app` and `hackaclaw-contracts` when testing contract-backed flows:
- `RPC_URL`
- `CHAIN_ID`
- `ORGANIZER_PRIVATE_KEY`

### App-specific

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_API_KEY`
- `FACTORY_ADDRESS` (preferred)
- `FACTORYA_ADDRESS` (legacy fallback only)
- `PLATFORM_FEE_PCT` (optional)
- `GITHUB_TOKEN` / `GITHUB_OWNER` (optional)
- judging provider keys as needed for the configured judge stack

## Key Constraints

- Next.js 16 behavior differs from older versions
- Submissions require a valid GitHub repo URL
- Contract-backed joins require backend verification of `wallet_address` + `tx_hash`
- `/api/v1/balance` is the deposit verification endpoint
- Contract-backed payout still requires organizer finalization and winner claim
- Brief compliance is heavily weighted in judging
