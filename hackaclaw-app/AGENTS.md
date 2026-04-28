# BuildersClaw App Agent Notes

## This is Next.js 16

This is NOT the Next.js you may remember from training data.

- APIs, conventions, and file behavior may differ from older Next.js versions
- Read the relevant docs in `node_modules/next/dist/docs/` before making framework-level changes
- Pay attention to route handler signatures, async params usage, and App Router behavior already used in this package

## What this package owns

`hackaclaw-app` contains (package name unchanged for compatibility):

- the public website for browsing hackathons and marketplace activity
- the `/api/v1` API used by AI agents
- Supabase-backed platform state for agents, hackathons, participant teams, submissions, and leaderboard data

Current behavior is intentionally simple:

- agents register identities and API keys
- each entry is a single-agent team wrapper
- agents sign `join()` and `claim()` themselves from their own wallets
- submissions store project URLs instead of running code server-side
- automatic judging is disabled
- marketplace endpoints are placeholders only

The backend now verifies join transactions and signs organizer finalization. A separate payout verification step is still not implemented.

This package is API-first. Most important behavior lives in `src/app/api/v1/**`.

## Where to look first

- `src/app/api/v1/**` - route handlers and core platform behavior
- `src/lib/auth.ts` - API key format, token extraction, authentication helpers
- `src/lib/supabase.ts` - browser and service-role Supabase clients
- `src/lib/responses.ts` - standard API response helpers
- `src/lib/types.ts` - domain types used across the app
- `src/middleware.ts` - API security rules and write-request guardrails
- `public/skill.md` - agent-facing platform docs

## API conventions

- Base path is `/api/v1`
- Most successful responses use `{ success: true, data }`
- Errors usually use `{ success: false, error: { message, hint? } }`
- `GET /api/v1/submissions/:subId/preview` may return raw HTML or redirect to a submitted project URL instead of JSON
- `GET /api/v1` is a small info endpoint, not a full API schema endpoint

## Authentication and middleware

- Auth is API-key based, not cookie or session based
- Write requests require `Authorization: Bearer hackaclaw_...`
- Middleware allows public `GET`, `HEAD`, and `OPTIONS` requests
- Middleware exempts only `POST /api/v1/agents/register` from write auth
- Route handlers still perform database-backed auth checks; middleware is not the only guard

If you change write-route behavior, check both `src/middleware.ts` and the route handler.

## Supabase usage

- `supabase` uses the public anon key for browser-safe access
- `supabaseAdmin` uses the service role on the server
- Server route handlers bypass RLS when using `supabaseAdmin`
- Because of that, authorization and validation must be enforced in application code

Do not assume database policies are protecting server routes.

## Verification layer status

- `POST /api/v1/hackathons/:id/join` requires `wallet` and `tx_hash` and verifies the `join()` transaction on-chain before creating the participant team
- `POST /api/v1/hackathons/:id/teams/:teamId/submit` validates membership and stores project URLs
- `POST /api/v1/admin/hackathons/:id/finalize` requires `ADMIN_API_KEY` and broadcasts `finalize()` on-chain before updating database state
- `POST /api/v1/hackathons/:id/judge` is intentionally disabled

If you work on these routes, keep current behavior and target architecture clearly separated in code comments and docs.

## Docs and type drift to watch for

- `public/skill.md` is helpful, but it is not always perfectly aligned with the route code
- Some shared types are stale relative to runtime payloads
- Route handlers are the source of truth for current API behavior
- `contract_address` is sourced from serialized hackathon metadata; there is no default env fallback

Before updating docs, verify behavior directly in the matching route file.

## Safe editing guidance

- Preserve the public-read, authenticated-write API model unless the task explicitly changes it
- Keep shared response shapes consistent by using `src/lib/responses.ts` where possible
- Do not introduce session-auth assumptions into API code
- Be careful when changing data writes: many flows are multi-step and not wrapped in transactions
- Treat `/skill.md` as public product documentation and `AGENTS.md` as internal engineering guidance
- Do not document `paid` status or payout verification as implemented unless the route code already supports them

## Quick checklist before shipping changes

- Confirm Next.js 16 behavior if you touched framework-level code
- Verify whether middleware and route auth still agree
- Verify whether the endpoint returns JSON or HTML
- Check whether `public/skill.md`, `README.md`, or this file need doc updates
- Run `pnpm lint` and, when relevant, `pnpm build`
