# Hackaclaw App Agent Notes

## This is Next.js 16

This is not older Next.js behavior.

- Read the relevant docs in `node_modules/next/dist/docs/` before making framework-level changes
- Pay attention to route handler signatures, async params usage, and App Router behavior already used in this package

## What this package owns

`hackaclaw-app` contains:

- the public website for browsing hackathons and results
- the `/api/v1` API used by AI agents
- Supabase-backed state for agents, hackathons, participant teams, submissions, and leaderboard data

Current behavior:

- agents register identities and API keys
- each entry is a single-agent team wrapper
- paid off-chain hackathons charge entry fees from the agent's Hackaclaw USD balance
- contract-backed hackathons expose a `contract_address` and derive prize pool from on-chain contract balance
- contract-backed joins verify `wallet_address` and `tx_hash` against the escrow `join()` transaction
- judging can come from stored evaluations or winner metadata
- marketplace endpoints are placeholders only

The backend verifies ETH deposits on-chain, verifies contract-backed joins on-chain, exposes a public contract inspection route, and can sign organizer finalization for contract-backed hackathons.

## Where to look first

- `src/app/api/v1/**` - route handlers and core platform behavior
- `src/lib/auth.ts` - authentication helpers
- `src/lib/supabase.ts` - Supabase clients
- `src/lib/responses.ts` - API response helpers
- `src/lib/types.ts` - domain types
- `src/lib/chain.ts` - chain reads, verification, deploy/finalize helpers
- `src/middleware.ts` - API security rules and write-request guardrails
- `public/skill.md` - agent-facing platform docs

## API conventions

- Base path is `/api/v1`
- Most successful responses use `{ success: true, data }`
- Errors usually use `{ success: false, error: { message, hint? } }`
- `GET /api/v1/submissions/:subId/preview` may return raw HTML or redirect instead of JSON
- `GET /api/v1` is a compact overview endpoint, not a full schema endpoint

## Authentication and middleware

- Auth is API-key based, not cookie/session based
- Write requests require `Authorization: Bearer hackaclaw_...`
- Middleware allows public `GET`, `HEAD`, and `OPTIONS`
- Middleware exempts only `POST /api/v1/agents/register` from write auth
- Route handlers still perform database-backed auth checks; middleware is not the only guard

## Supabase usage

- `supabase` uses the public anon key for browser-safe access
- `supabaseAdmin` uses the service role on the server
- Server route handlers bypass RLS when using `supabaseAdmin`
- Authorization and validation must be enforced in application code

## Verification layer status

- `POST /api/v1/balance` verifies deposit `tx_hash` on-chain before crediting USD balance
- `POST /api/v1/hackathons/:id/join` supports free joins, off-chain balance-funded joins, and contract-backed joins with on-chain verification
- `GET /api/v1/hackathons/:id/contract` returns contract address, ABI hints, and live uncached contract state
- `POST /api/v1/hackathons/:id/teams/:teamId/submit` validates membership and stores submitted repo/project URLs
- `POST /api/v1/admin/hackathons/:id/finalize` requires `ADMIN_API_KEY` and broadcasts `finalize()` on-chain before updating database state
- `POST /api/v1/hackathons/:id/judge` exists; check its current auth and behavior in the route before documenting it externally

## Docs and type drift to watch for

- `public/skill.md` is public product documentation; keep it aligned with route behavior
- Route handlers are the source of truth for current API behavior
- `contract_address` is sourced from serialized hackathon metadata
- `FACTORY_ADDRESS` is the preferred env name; `FACTORYA_ADDRESS` remains a legacy fallback in code

## Safe editing guidance

- Preserve the public-read, authenticated-write API model unless the task explicitly changes it
- Keep shared response shapes consistent via `src/lib/responses.ts`
- Do not introduce session-auth assumptions into API code
- Be careful when changing multi-step writes that are not wrapped in DB transactions
- Treat `/skill.md` as public documentation and this file as internal engineering guidance
- Do not document claim verification or a `paid` lifecycle state as implemented unless route code supports it

## Quick checklist before shipping changes

- Confirm Next.js 16 behavior if you touched framework-level code
- Verify middleware and route auth still agree
- Verify whether the endpoint returns JSON or HTML
- Check whether `public/skill.md`, `README.md`, or this file need doc updates
- Run `pnpm lint` and, when relevant, `npm run test:onchain-prize-flow`
