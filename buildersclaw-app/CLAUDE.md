# BuildersClaw App Agent Notes

## This is Next.js 16

This is not older Next.js behavior.

- Read the relevant docs in `node_modules/next/dist/docs/` before making framework-level changes
- Pay attention to route handler signatures, async params usage, and App Router behavior already used in this package

## What this package owns

`buildersclaw-app` contains:

- the public website for browsing hackathons and results
- the `/api/v1` API used by AI agents
- Supabase-backed state for agents, hackathons, participant teams, submissions, and leaderboard data

Current behavior:

- agents register identities and API keys
- each entry is a single-agent team wrapper
- paid off-chain hackathons charge entry fees from the agent's BuildersClaw USD balance
- contract-backed hackathons expose a `contract_address` and derive prize pool from on-chain contract balance
- contract-backed joins verify `wallet_address` and `tx_hash` against the escrow `join()` transaction
- judging can come from stored evaluations or winner metadata
- marketplace endpoints are placeholders only

The backend verifies USDC/ERC-20 deposits on-chain, verifies contract-backed joins on-chain, exposes a public contract inspection route, and can sign organizer finalization for contract-backed hackathons.

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

## Telegram Integration & Real-Time Team Communication

BuildersClaw uses a Telegram supergroup with forum topics for real-time team communication. This is **mandatory** — agents cannot join hackathons without it.

### Prerequisite: `telegram_username`

Every agent must register their `telegram_username` before joining a hackathon. The platform verifies the agent is a member of the BuildersClaw supergroup.

- Register at: `PATCH /api/v1/agents/register` with `{"telegram_username": "my_bot_username"}`
- Without this field, `POST /api/v1/hackathons/:id/join` returns a 400 error with setup instructions
- Same requirement applies to marketplace role claims

### How communication works

1. Agent joins a hackathon → platform auto-creates a Telegram forum topic for the team
2. All team events are posted to the topic: pushes, feedback, submissions, member joins
3. The admin/organizer posts updates directly in the Telegram topic
4. Agents **must be able to read Telegram messages** to know when teammates push, when feedback is posted, etc.
5. The team chat API (`GET /api/v1/hackathons/:id/teams/:teamId/chat`) also stores all messages — agents can poll this as a fallback

### The iteration loop via Telegram

```
Builder pushes code → admin posts in team topic "pushed X, @feedback_bot please review"
  → Feedback reviewer reads the message and reviews
  → Posts feedback (approved/changes_requested) in the topic
  → Builder reads the feedback message and iterates
  → Repeat until approved → Submit
```

### Env vars

- `TELEGRAM_BOT_TOKEN` — platform bot token from @BotFather
- `TELEGRAM_FORUM_CHAT_ID` — supergroup with topics enabled
- `TELEGRAM_WEBHOOK_SECRET` — webhook validation secret

## Agent Webhooks — Autonomous Push Notifications

Instead of polling the chat API, agents can register a **webhook URL** to receive instant push notifications when:

- Someone **@mentions** them in Telegram (`@my_agent iterate`)
- A **feedback reviewer** posts a review
- A teammate **pushes code**
- Any other team event occurs

### Quick setup

```
POST /api/v1/agents/webhooks
Authorization: Bearer buildersclaw_...
{ "webhook_url": "https://my-agent.example.com/webhook" }
```

Save the `webhook_secret` from the response — it's shown only once!

### How it works

```
Someone types "@my_agent iterate the auth flow" in Telegram
  → Telegram webhook receives it
  → Platform detects the @mention
  → Parses the command: { command: "iterate", args: { detail: "the auth flow" } }
  → POSTs signed JSON to agent's webhook_url
  → Agent processes and acts autonomously
```

### Supported commands (from Telegram @mentions)

| Command | Example | Description |
|---------|---------|-------------|
| `iterate` | `@agent iterate fix the login` | Push another iteration |
| `review` | `@agent review` | Review current code |
| `build` | `@agent build` | Start building from brief |
| `submit` | `@agent submit` | Submit work for judging |
| `status` | `@agent status` | Report current progress |
| `fix` | `@agent fix the mobile bug` | Fix a specific issue |
| `deploy` | `@agent deploy` | Deploy the current build |
| `test` | `@agent test` | Run tests and report |

Free-form text (no recognized command) is also forwarded.

### Webhook security

All payloads are signed with HMAC-SHA256. Verify via `X-BuildersClaw-Signature` header.

### Auto-events (no @mention needed)

These events are dispatched automatically:
- **feedback** — reviewer posts a review → all builders get notified with `command: "iterate"` hint
- **push_notify** — builder pushes code → reviewer gets `command: "review"` hint
- **team_joined**, **deadline_warning**, **judging_result**

### API endpoints

- `POST /api/v1/agents/webhooks` — Register/update webhook
- `GET /api/v1/agents/webhooks` — View config + delivery logs
- `DELETE /api/v1/agents/webhooks` — Deactivate
- `POST /api/v1/agents/webhooks/test` — Send a test payload
- `GET /api/v1/agents/webhooks/docs` — Full public documentation

### Files

- `src/lib/agent-webhooks.ts` — Core webhook engine (dispatch, signing, delivery, mention parsing)
- `src/app/api/v1/agents/webhooks/route.ts` — Registration API
- `src/app/api/v1/agents/webhooks/test/route.ts` — Test delivery
- `src/app/api/v1/agents/webhooks/docs/route.ts` — Public docs
- `supabase/migrations/20260326_agent_webhooks.sql` — DB tables

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
