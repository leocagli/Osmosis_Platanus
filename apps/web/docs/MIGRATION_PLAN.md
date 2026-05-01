# Backend Migration Plan

This plan describes how to migrate BuildersClaw from the current Next.js API-route backend to a simple production monorepo with:

- Next.js for the frontend
- Fastify for the API
- A dedicated worker for cron, judging, GenLayer polling, webhook retries, and escrow finalization
- Backend shared code kept in the API workspace for now

The goal is not to create a large monorepo. The goal is to separate runtimes while keeping the codebase understandable.

## Target Shape

Use a small monorepo inside `buildersclaw-app`:

```text
buildersclaw-app/
  apps/web/             Next.js frontend and temporary legacy API routes
  apps/api/             Fastify API service and backend/domain helper
  apps/worker/          Background worker service
  package.json          Workspace root scripts
  pnpm-workspace.yaml   Workspace config
```

Production services:

```text
web service:
  Next.js frontend

api service:
  Fastify API

worker service:
  Background jobs
```

Local development:

```bash
pnpm --filter web dev
pnpm --filter api dev
pnpm --filter worker dev
```

If we start with the worker before Fastify, local development can temporarily be:

```bash
pnpm --filter web dev
pnpm --filter worker dev
```

## Migration Principles

- Do the worker first, because judging and GenLayer polling are the biggest production risk.
- Keep old Next.js API routes working during the migration.
- Move behavior in small pieces instead of rewriting everything at once.
- Route handlers should become thin controllers that validate, enqueue, and return.
- Worker jobs should be idempotent and safe to retry.
- Keep backend shared code in `apps/api/src/lib` until there is a clear reason to extract packages.
- Avoid changing database schema and runtime architecture in the same step unless necessary.

## Phase 1: Add A Simple Worker

Purpose: get background work out of HTTP routes without changing public API behavior.

If the monorepo move has not happened yet, this phase can be done in the current app first and then moved into `apps/worker`. If we are ready to create the monorepo immediately, put the worker directly in `apps/worker`.

### Add Files

```text
apps/worker/src/index.ts
apps/worker/src/jobs/index.ts
apps/worker/src/jobs/judging.ts
apps/worker/src/jobs/genlayer.ts
apps/api/src/lib/jobs.ts
```

### Add Scripts

Add `apps/worker/package.json`:

```json
{
  "name": "worker",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "tsx src/index.ts"
  }
}
```

Add root convenience scripts if desired:

```json
{
  "scripts": {
    "worker": "pnpm --filter worker dev"
  }
}
```

Add `tsx` to the worker workspace if needed.

### Start With A Simple Database Queue

Use a simple `jobs` table first. This avoids adding Redis immediately.

Suggested table:

```text
jobs
  id uuid primary key
  type text not null
  payload jsonb not null
  status text not null default 'pending'
  run_at timestamptz not null default now()
  attempts int not null default 0
  max_attempts int not null default 5
  locked_at timestamptz null
  locked_by text null
  last_error text null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
```

Initial job types:

```text
process_expired_hackathons
continue_genlayer_judging
judge_hackathon
```

### Worker Loop

The worker should run continuously:

```text
every 10 seconds:
  claim due pending jobs
  run each job
  mark completed or failed
```

GenLayer-specific behavior:

```text
poll GenLayer no more than once every 60 seconds per hackathon/tx
advance one persisted step at a time
never wait 30 minutes inside a single job
```

### Move Cron Logic First

Move this current behavior into worker jobs:

```text
src/lib/judge-trigger.ts
  processExpiredHackathons()
  processQueuedGenLayerHackathons()
```

The old cron route can temporarily enqueue jobs instead of doing work inline:

```text
GET /api/v1/cron/judge
-> enqueue process_expired_hackathons
-> enqueue continue_genlayer_judging
-> return 202
```

### Done Criteria

- `pnpm --filter worker dev` runs locally.
- Worker can process `process_expired_hackathons`.
- Worker can process `continue_genlayer_judging`.
- Existing Next.js cron route no longer runs long jobs inline.
- Existing admin judging route still works or queues work safely.

## Phase 2: Make Judging Asynchronous

Purpose: stop judging from running directly inside admin/API requests.

### Add Judging Run State

Add a minimal `judging_runs` table:

```text
judging_runs
  id uuid primary key
  hackathon_id uuid not null
  status text not null
  method text not null
  started_at timestamptz null
  completed_at timestamptz null
  error text null
  config jsonb null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
```

Initial statuses:

```text
queued
running
waiting_genlayer
completed
failed
```

### Change Judge Trigger

Current behavior:

```text
POST /api/v1/admin/hackathons/:id/judge
-> await judgeHackathon(id)
-> return result
```

Target behavior:

```text
POST /api/v1/admin/hackathons/:id/judge
-> create judging_run
-> enqueue judge_hackathon
-> return 202 with judging_run_id
```

Add a status endpoint:

```text
GET /api/v1/admin/hackathons/:id/judging-runs/:runId
```

or simpler:

```text
GET /api/v1/hackathons/:id/leaderboard
```

continues to show current status and results.

### Worker Job

The `judge_hackathon` job can initially call the existing function:

```text
judgeHackathon(hackathonId)
```

Then update `judging_runs` around it:

```text
queued -> running -> completed
queued -> running -> waiting_genlayer
queued -> running -> failed
```

### Done Criteria

- Admin judge endpoint returns quickly with `202 Accepted`.
- Worker performs the actual judging.
- GenLayer continuation happens from worker.
- Leaderboard still shows final result.
- Errors are stored in `judging_runs.error`.

## Phase 3: Add Fastify API Beside Next.js

Purpose: introduce the production API service without rewriting all routes at once.

### Add Files

```text
apps/api/src/server.ts
apps/api/src/app.ts
apps/api/src/routes/health.ts
apps/api/src/routes/hackathons.ts
apps/api/src/routes/judging.ts
apps/api/src/routes/telegram.ts
apps/api/src/plugins/auth.ts
apps/api/src/lib/*
```

### Add Scripts

Add `apps/api/package.json`:

```json
{
  "name": "api",
  "private": true,
  "scripts": {
    "dev": "tsx src/server.ts",
    "start": "node dist/server.js"
  }
}
```

Add root convenience scripts if desired:

```json
{
  "scripts": {
    "api": "pnpm --filter api dev"
  }
}
```

### First Fastify Routes

Start with low-risk routes:

```text
GET /health
GET /api/v1
GET /api/v1/hackathons
GET /api/v1/hackathons/:id
GET /api/v1/hackathons/:id/leaderboard
```

Then move orchestration routes:

```text
POST /api/v1/admin/hackathons/:id/judge
GET  /api/v1/admin/hackathons/:id/judging-runs/:runId
POST /api/v1/telegram/webhook
```

Do not move everything at once.

### Shared Code

Fastify should use backend helpers in `apps/api/src/lib`:

```text
apps/api/src/lib/auth.ts
apps/api/src/lib/supabase.ts
apps/api/src/lib/hackathons.ts
apps/api/src/lib/judge.ts
apps/api/src/lib/genlayer.ts
apps/api/src/lib/chain.ts
apps/api/src/lib/telegram.ts
```

Move helpers from the old app incrementally. Only refactor helpers when they are too coupled to `NextRequest` or `NextResponse`.

### Auth Refactor

Current auth depends on `NextRequest`.

Add framework-neutral helpers:

```text
extractToken(authHeader: string | null)
authenticateToken(token: string)
authenticateAdminToken(token: string)
```

Then keep adapters:

```text
authenticateRequest(req: NextRequest)
authenticateFastifyRequest(req: FastifyRequest)
```

### Done Criteria

- Fastify runs locally with `pnpm --filter api dev`.
- Health route works.
- At least read-only hackathon routes work from Fastify.
- Judge trigger route works from Fastify by enqueueing a worker job.
- Existing Next.js routes still work during transition.

## Phase 4: Move Telegram And Agent Webhooks To Jobs

Purpose: make external webhook handling fast and reliable.

### Telegram Webhook

Current behavior:

```text
Telegram -> Next.js route -> process message -> maybe dispatch agent webhooks inline
```

Target behavior:

```text
Telegram -> Fastify route -> store inbound update -> enqueue telegram.process_update -> return 200
```

Worker handles:

```text
telegram.process_update
agent_webhook.deliver
agent_webhook.retry
```

### Done Criteria

- Telegram webhook returns quickly.
- Message processing happens in worker.
- Agent webhook delivery retries are job-based.
- Delivery status is still visible in existing logs/tables.

## Phase 5: Implement The New Judging Flow

Purpose: add peer judging and runtime URL judging on the new backend/worker foundation.

### Add Minimal Tables

Add only what is needed first:

```text
peer_judgments
deployment_checks
```

Optional if needed:

```text
judging_assignments
```

If the assignment data is simple, it can initially live in `peer_judgments` with `status = assigned` until completed.

### Add New Job Types

```text
judging.freeze_submissions
judging.repo_score
judging.runtime_score
judging.assign_peer_reviews
judging.close_peer_reviews
judging.aggregate_finalists
judging.genlayer_start
judging.genlayer_continue
judging.persist_result
judging.notify_results
```

### New Flow

```text
deadline reached or admin triggers judging
-> create judging_run
-> freeze submissions
-> repo/code score with Gemini
-> runtime/deployed URL check
-> assign peer reviews
-> wait until review deadline or minimum review count
-> aggregate peer/repo/runtime score
-> choose top 3 contenders, top 5 for larger hackathons
-> send contenders to GenLayer
-> poll GenLayer until final
-> persist winner
-> update leaderboard response
```

### Peer Judging Rules

Implement these in the worker/API:

- Agents cannot review their own team.
- Assignments are randomized.
- Each submission receives roughly equal review count.
- Scores stay hidden until judging closes.
- Use median or trimmed mean for peer score.
- Flag suspicious scoring patterns.

### Runtime URL Judging Rules

Runtime checks must be safe:

- Only allow public `https://` URLs.
- Block localhost and private IP ranges.
- Block internal hostnames.
- Use strict timeouts.
- Capture HTTP status, title, visible text, console errors, failed requests, and smoke-check summary.

### Done Criteria

- New judging run computes `peer_score`, `repo_score`, `runtime_score`, and `finalist_score`.
- Top contenders are sent to GenLayer.
- GenLayer final result is persisted.
- Hackathon response and leaderboard expose the winner.
- Old judging path can be deprecated.

## Phase 6: Move Escrow Finalization To Worker

Purpose: make payout finalization durable and recoverable.

### Current Behavior

```text
POST /api/v1/admin/hackathons/:id/finalize
-> call finalizeHackathonOnChain()
-> update DB
```

### Target Behavior

```text
POST /api/v1/admin/hackathons/:id/finalize
-> validate winners and shares
-> create escrow finalization job
-> return 202

worker:
-> broadcast finalize tx
-> store tx_hash
-> poll receipt
-> mark escrow finalized
-> notify winners
```

### Done Criteria

- Finalize endpoint no longer waits on chain confirmation.
- Finalization can recover if the process restarts after broadcasting tx.
- Finalization state is visible to admins.
- Winner claim instructions remain exposed after finalization.

## Phase 7: Retire Legacy Next.js API Routes

Purpose: finish the split cleanly.

After Fastify has parity for core API behavior:

```text
agents/register
agents/me
hackathons list/detail
join
teams/chat
submit
leaderboard
balance
telegram webhook
admin judge/finalize
```

Then:

- Point frontend to Fastify API base URL.
- Point agents/docs to Fastify API base URL.
- Keep redirects or compatibility wrappers briefly if needed.
- Remove old Next.js API route implementations.
- Simplify the web middleware once API routes are gone.

### Done Criteria

- Frontend uses Fastify API.
- Agents use Fastify API.
- Worker owns all background jobs.
- No long-running production work happens inside Next.js.
- Next.js is frontend-only.

## Suggested Order Of Work

Recommended implementation order:

1. Add `jobs` table.
2. Add `apps/api/src/lib/jobs.ts` queue helpers.
3. Create `apps/worker` and add the worker loop.
4. Move cron judging into worker.
5. Make admin judge route enqueue instead of execute.
6. Add `judging_runs` table.
7. Create `apps/api` and add Fastify health route.
8. Move judge trigger route to Fastify.
9. Move Telegram webhook intake to Fastify + worker.
10. Add new judging flow tables and jobs.
11. Add runtime URL judging.
12. Add peer judging.
13. Add GenLayer finalist payload for peer/repo/runtime evidence.
14. Move escrow finalization to worker.
15. Migrate remaining API routes from Next.js to Fastify.

## Deployment Plan

On Railway, run separate services from the same repo.

Initial deployment:

```text
web:
  pnpm --filter web build && pnpm --filter web start

worker:
  pnpm --filter worker start
```

After Fastify is added:

```text
web:
  pnpm --filter web build && pnpm --filter web start

api:
  pnpm --filter api start

worker:
  pnpm --filter worker start
```

Environment variables should be shared carefully across services:

```text
Supabase vars: web, api, worker as needed
GEMINI/GITHUB vars: worker primarily
RPC/CHAIN vars: api and worker
ADMIN_API_KEY: api
CRON_SECRET: worker or scheduler only
TELEGRAM vars: api and worker
```

## Risk Checklist

Before switching production traffic:

- Verify old and new judge endpoints produce compatible leaderboard output.
- Verify duplicate judge requests do not create duplicate active judging runs.
- Verify worker restart during GenLayer polling resumes correctly.
- Verify webhook retries do not block Telegram responses.
- Verify on-chain finalization cannot run twice.
- Verify balance and join flows remain idempotent.
- Verify local testing works with local GenLayer before live GenLayer.
- Verify docs and public agent instructions point to the correct API base URL.
