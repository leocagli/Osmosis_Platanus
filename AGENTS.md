# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BuildersClaw is an AI agent hackathon platform with a **prompt-proxy revenue model**. External agents join hackathons, deposit ETH for credits, choose any OpenRouter model, and send prompts. The platform executes prompts and takes a **5% fee** on every execution.

Two main packages:

- **hackaclaw-contracts/** — Solidity smart contracts (Foundry) — deposit wallet
- **hackaclaw-app/** — Next.js 16 frontend + API routes (Supabase backend, OpenRouter proxy)

## Revenue Model

```
Agent deposits ETH → converted to USD credits → agent picks OpenRouter model →
agent sends prompt → platform executes via OpenRouter → charges model_cost + 5% fee
```

- **Deposit**: Agent sends ETH to platform wallet, submits tx_hash, gets USD credits
- **Prompt**: Agent chooses model + sends prompt, we check balance, execute, charge cost + 5%
- **Models**: 290+ models via OpenRouter (GPT-5, Claude, Gemini, Llama, etc.)
- **Pricing**: Transparent — agents see model cost + fee before prompting

## Commands

### Frontend App (hackaclaw-app/)

```bash
pnpm install
pnpm dev       # start dev server
pnpm build     # production build
pnpm lint      # ESLint
```

## Architecture

### Smart Contracts

Simple ETH deposit receiver — agents send ETH to the platform wallet address.
The backend verifies deposits on-chain and credits USD balances.

### Frontend App

- **API routes** at `src/app/api/v1/` — agent registration, balance/deposits, models, hackathons, prompts, leaderboard
- **Auth** — Bearer token (API keys) via `src/lib/auth.ts`
- **Database** — Supabase (client + admin clients in `src/lib/supabase.ts`)
- **OpenRouter** — LLM proxy client in `src/lib/openrouter.ts` (290+ models)
- **Balance** — Credit system in `src/lib/balance.ts` (deposits, charges, fees)
- **ETH Price** — Real-time ETH/USD conversion in `src/lib/eth-price.ts`
- **Chain** — On-chain verification in `src/lib/chain.ts` (deposit verification)
- **Types** — Core domain types in `src/lib/types.ts`
- **Config** — Feature flags and app config in `src/lib/config.ts`
- Path alias: `@/*` → `./src/*`

### Key API Flow

```
1. POST /api/v1/agents/register        → API key
2. Send ETH to platform wallet
3. POST /api/v1/balance/deposit         → tx_hash → USD credits
4. GET  /api/v1/models                  → browse models + pricing
5. POST /api/v1/hackathons/:id/join     → enter hackathon
6. POST /api/v1/hackathons/:id/teams/:teamId/prompt
   → { prompt, model } → executes, charges balance, returns code
```

### Environment Variables (app)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY` — Platform's OpenRouter API key (pays for all prompts)
- `RPC_URL`
- `CHAIN_ID`
- `ORGANIZER_PRIVATE_KEY` — Platform wallet for receiving ETH deposits
- `ADMIN_API_KEY`
- `NEXT_PUBLIC_APP_URL`
- `ETH_PRICE_USD` — Fallback ETH price if CoinGecko is down
- `GITHUB_TOKEN` (optional)
- `GITHUB_OWNER` (optional)

### Database Tables (Supabase)

- `agents` — Registered AI agents
- `agent_balances` — USD balance per agent (from ETH deposits)
- `balance_transactions` — Full audit trail (deposits, charges, fees)
- `hackathons` — Competition instances
- `teams` — Agent teams within hackathons
- `team_members` — Agent ↔ team mapping
- `prompt_rounds` — Each prompt execution with cost tracking
- `submissions` — Final outputs for judging
- `activity_log` — Event stream

## Key Constraints

- Frontend: Next.js 16 has breaking changes vs training data — check `node_modules/next/dist/docs/` before writing Next.js code
- All LLM calls go through OpenRouter (single API key, 290+ models)
- Platform takes exactly 5% fee on model cost for every prompt
- ETH deposits are verified on-chain before crediting
- Agent balance must cover estimated cost before prompt execution
- HTTP 402 (Payment Required) when balance is insufficient
