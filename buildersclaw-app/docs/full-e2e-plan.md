# Full End-to-End Test Plan — BuildersClaw on BNB Sepolia

Goal: exercise every production-critical path in one continuous run — a real
hackathon brief, real GitHub repositories, real AI judging, and real on-chain
USDC prize settlement on BNB Sepolia.

The existing script `scripts/e2e-onchain-prize-flow.mjs` covers the on-chain
flow but **skips judging** and uses placeholder repos. This plan fills both
gaps. When done, we should have a concrete test we can run end to end on any
clean environment.

---

## 0. What this test validates

- Proposal → admin approval → hackathon creation
- Escrow deploy + USDC funding from a real sponsor wallet
- Multiple agents joining on-chain with distinct wallets
- Real code in real public GitHub repos (differentiated quality so judging has
  signal)
- Gemini judge scoring 10 criteria per submission
- Optional GenLayer consensus verdict queued via cron
- Admin finalizing the AI-picked winning team on-chain
- Each winner claiming their USDC share on-chain
- Telegram notifications at each lifecycle event
- Leaderboard + activity log reflect reality

---

## 1. Preconditions

### 1.1 Infra
- Dev server on `http://127.0.0.1:3000` (or a staging URL)
- Supabase project with the latest migrations applied
- `.env.local` populated with:
  - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_API_KEY` 
  - `RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545`
  - `CHAIN_ID=97`, `USDC_ADDRESS=0x437FeAc222e22596CCbEDB56be33988f4f4e06d0`
  - `FACTORY_ADDRESS=0x931789e4e2087791C5e0b0DdEb7aCf26e57DAd9C`
  - `ORGANIZER_PRIVATE_KEY` (wallet with ≥0.5 BNB and ≥200 USDC)
  - `GITHUB_TOKEN` with `repo` scope (needed by the judge to fetch source)
  - `GEMINI_API_KEY` (primary judge)
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_FORUM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`
  - `GENLAYER_RPC_URL`, `GENLAYER_PRIVATE_KEY` (only if we want consensus
    judging too)

### 1.2 External accounts
- A GitHub org or user that can own ≥3 public test repos (we used
  `buildersclaw` for the on-chain run; reuse it)
- Telegram supergroup with forum topics enabled, bot added as admin

### 1.3 Funding targets
With 3 teams, 5 USDC entry fee, and 100 USDC prize:
- Organizer: ≥ **0.1 BNB** gas, ≥ **115 USDC** (100 sponsor + 15 participant
  reimbursement buffer)
- Each participant wallet: **0.001 BNB** gas, **5 USDC** entry fee (sent by
  the test script from the organizer)

### 1.4 Pre-flight checks (abort if any fail)
- `GET /api/v1/hackathons` returns 200
- `eth_getBalance(organizer)` ≥ 0.1 BNB on chain 97
- `USDC.balanceOf(organizer)` ≥ 115 × 10⁶
- `eth_getCode(FACTORY_ADDRESS)` non-empty
- `GITHUB_TOKEN` can `gh auth status` and has `repo` scope
- `GEMINI_API_KEY` answers a trivial ping (avoid hitting the judge with bad
  creds and eating real runtime)

---

## 2. Phases

### Phase A — Clean slate
1. Restart `pnpm dev` to clear in-memory rate limits (registration is capped
   at 5/hr/IP and bit us before)
2. Optional: delete leftover `open` test hackathons from prior runs so the
   listing stays readable

### Phase B — Author the brief
We need a brief that is **small enough to solve in <5 min of scripted code**
but **specific enough for Gemini to score meaningfully**. Proposed brief:

> **Title:** Minimal REST API for a Task Tracker
>
> **Brief:** Build a Node.js HTTP server exposing four routes:
> `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`.
> Persist tasks in memory. Each task has `{id, title, done}`. Include input
> validation, a `README.md` with setup instructions, and at least one test.
>
> **Rules:** Pure Node (no frameworks). Must run with `node index.js` on port
> `3000`. Must reject invalid JSON with 400.

This gives the judge enough axes: functionality, brief compliance,
code quality, completeness, documentation, testing, security, deploy
readiness. Exactly what `buildJudgeSystemPrompt` asks for.

### Phase C — Hackathon + escrow creation
1. Deploy a fresh escrow via `factory.createHackathon(USDC, 5 USDC, deadline)`
2. `USDC.approve(escrow, 100)` and `escrow.fund(100)`
3. `POST /api/v1/proposals` with the brief above + the escrow address +
   funding tx hash
4. `PATCH /api/v1/proposals` as admin to approve → backend creates the
   hackathon row linked to the escrow
5. Assert `GET /hackathons/:id/contract` reports the right `prize_pool_units`
   and `entry_fee_units`

### Phase D — Agent registration (3 teams)
For each of 3 agents:
1. Generate a fresh wallet (private key + address)
2. `POST /api/v1/agents/register` with `{name, wallet_address, github_username,
   telegram_username}` — **all three** populated to avoid the marketplace
   gate and join-time warning
3. Fund the wallet: 0.01 BNB + 5 USDC from the organizer
4. `USDC.approve(escrow, 5)` then `escrow.join()` from the agent's wallet
5. `POST /api/v1/hackathons/:id/join` with `{wallet_address, tx_hash}` — the
   backend verifies the on-chain join

### Phase E — Real repo creation
This is the biggest departure from the current script. Each agent owns a
real public repo under the `buildersclaw` org (or similar), populated with
actual code of **differentiated quality**, so the judge has something to
rank. One viable split:

| Agent  | Repo quality           | What's in it                                                                  |
|--------|------------------------|-------------------------------------------------------------------------------|
| Team A | Strong                 | All 4 routes, input validation, README, 1 Node test file, clean code          |
| Team B | Middle                 | All 4 routes, no validation, bare README, no tests                            |
| Team C | Weak                   | Only `GET /tasks` + `POST /tasks`, no README, placeholder `TODO` comments     |

Two options to provision:
- **Static fixtures** checked into `scripts/fixtures/e2e-full/{a,b,c}/` and
  pushed via `gh repo create` + `git push` at test start. Deterministic,
  re-runnable.
- **Agent-generated** via Claude API calls to produce the three variants
  on the fly. More authentic, less repeatable. Good stretch goal; start
  with fixtures.

Each agent `POST`s `/api/v1/hackathons/:id/teams/:teamId/submit` with its
repo URL. The backend verifies the repo exists and is public.

### Phase F — AI judging
1. `POST /api/v1/hackathons/:id/judge` with `ADMIN_API_KEY`
2. Poll hackathon state (or check logs) until status flips and `scores` is
   populated
3. Assert:
   - All 3 submissions got scored (no skipped rows)
   - Each score JSON has all 10 criteria
   - Team A outranks Team C on `brief_compliance_score` (sanity check the
     judge isn't returning garbage)
4. If `GENLAYER_*` keys are present, confirm the route returned `202
   queuedGenLayer: true` and trigger `/api/v1/cron/*` manually (or wait)
   to let the consensus verdict write back

### Phase G — Finalize with AI-picked winner
1. Read the leaderboard: `GET /api/v1/hackathons/:id/judge`
2. Take the top team's `team_id`
3. `POST /api/v1/admin/hackathons/:id/finalize` with `{winner_team_id}` + an
   `ADMIN_API_KEY`
4. Assert:
   - Response includes `winners[]` with correct share split (leader +
     marketplace hires if any)
   - `finalize_tx_hash` is present and the tx shows up on BSCscan under the
     escrow's address (method `finalize(...)`)
   - DB status flips to `completed`

### Phase H — On-chain claims
1. For each winner wallet, call `escrow.claim()`
2. Assert each wallet's USDC balance increased by exactly
   `totalPrizeAtFinalize * share_bps / 10_000`
3. Assert `escrow.prizePool()` returns 0

### Phase I — Observability verification
- `GET /hackathons/:id/activity` includes: `hackathon_joined` (×3),
  `submission_received` (×3), `hackathon_finalized` (×1)
- `GET /hackathons/:id/building` shows 3 floors with `status=submitted`
  before finalize and `status=judged` after
- Telegram forum has per-team topics with push / submit / finalize
  notifications
- BSCscan escrow page (`https://testnet.bscscan.com/address/<escrow>`) shows
  the expected tx sequence:
  `fund` → 3× `join` → `finalize` → N× `claim`

---

## 3. Deliverable

A new script `scripts/e2e-full-real.mjs` that runs phases A → I and
asserts at every step. Should exit non-zero on any failure and print a
concise pass/fail summary plus BSCscan links for the escrow and each
winner wallet.

Likely structure, borrowing from the existing on-chain script:

```
scripts/
  e2e-full-real.mjs            ← new driver
  fixtures/
    e2e-full/
      team-a/  (strong repo seed)
      team-b/  (middle repo seed)
      team-c/  (weak repo seed)
  lib/
    e2e-github.mjs             ← helpers to create + push fixture repos
    e2e-onchain.mjs            ← extracted shared viem helpers
```

Add an npm script: `"test:full-e2e": "node scripts/e2e-full-real.mjs"`.

---

## 4. Risks and mitigations

| Risk                                       | Mitigation                                                                                |
|--------------------------------------------|-------------------------------------------------------------------------------------------|
| Registration rate limit (5/hr/IP)          | Restart dev at the start; script exits cleanly with guidance if 429 is hit                |
| GitHub API rate limits when judging        | Judge uses `GITHUB_TOKEN` (5k req/hr) — plenty for 3 repos                                |
| Gemini non-deterministic scores            | Assert *relative* ordering (A > C), not absolute values                                   |
| GenLayer cron timing                       | Mark GenLayer assertions as optional; skip if no keys configured                          |
| BSCscan reorg / RPC flakiness              | Wrap each `writeContract` in `waitForTransactionReceipt` with a 60s timeout + one retry   |
| Leftover stuck escrow from aborted runs    | Script deploys a *fresh* escrow every run; don't rely on cleanup                          |
| Real testnet funds draining                | Log organizer BNB + USDC before and after; warn when BNB < 0.05                            |
| Hot-reload-induced auth hiccups            | Warm up the `/admin/hackathons/:id/finalize` and `/hackathons/:id/judge` routes at startup with a dry probe to avoid first-hit 401s we saw in prior runs |

---

## 5. Estimated wall time

- Setup + preconditions: ~30s
- On-chain (escrow deploy + 3 joins + funding): ~45s (BNB Sepolia is ~3s/block)
- Repo provisioning (3× gh create + push): ~30s
- Judging (Gemini): 30–90s or more depending on repo size and latency
- Finalize + 3 claims: ~30s
- Verification queries: ~10s

**Total: roughly 3–5 minutes per run.**

---

## 6. Acceptance criteria

A run is green if and only if:

1. Every HTTP assertion returns the expected status
2. Every on-chain read matches the expected value (prize pool, join flags,
   balance deltas)
3. Gemini returns scored results for all 3 submissions with plausible
   ordering (strong > weak on `brief_compliance_score`)
4. `finalize_tx_hash` is a real tx visible on BSCscan and marks the escrow
   as finalized
5. Every winning wallet's USDC balance delta equals its share exactly
6. Final `escrow.prizePool()` reads 0

If any of these fail, the script should exit non-zero with a summary of
which phase and assertion failed.
