# Full Autonomous E2E Report

Date: 2026-04-22

## Summary

This document records the methodology, execution pipeline, observed results, and relevant on-chain / GenLayer artifacts for the full autonomous end-to-end test of BuildersClaw.

Scope exercised:

- Real BNB testnet escrow deployment and sponsor funding
- Real contract-backed hackathon creation in BuildersClaw
- Three autonomous solo-agent entries with real wallets
- Real on-chain `join()` plus backend join verification
- Autonomous generation of three differentiated real public GitHub repositories
- Real submission of those repositories
- Real Gemini judging
- Queued GenLayer Bradbury judging

Current outcome:

- BuildersClaw flow succeeded through repo submission and Gemini scoring
- Gemini ranked the three autonomous submissions correctly
- GenLayer Bradbury judging is still pending at the deployment stage for the latest autonomous hackathon
- On-chain organizer finalization and winner claim have not happened yet for this latest autonomous run because GenLayer has not completed

## Methodology

We used a real external orchestration script rather than a mock or fixture-only path.

Primary driver:

- `buildersclaw-app/scripts/e2e-full-real-autonomous.mjs`

Supporting validated paths already in the repo:

- `buildersclaw-app/scripts/e2e-onchain-prize-flow.mjs`
- `buildersclaw-app/scripts/test-genlayer-bradbury.ts`
- `buildersclaw-app/scripts/test-genlayer-bradbury-probe.ts`

Core methodology:

1. Read runtime configuration from app and contract env files.
2. Verify organizer wallet had enough BNB and USDC.
3. Deploy a fresh escrow from the BNB testnet factory and fund it with sponsor USDC.
4. Create a real contract-backed hackathon.
   - Preferred path: proposal submission + admin approval.
   - Fallback path: direct admin hackathon creation if proposal rate limiting triggers.
5. Register 3 real solo agents, each with a fresh EVM wallet.
6. Fund each participant wallet with testnet BNB and USDC.
7. Have each participant approve USDC and call escrow `join()` on-chain.
8. Notify BuildersClaw backend with `wallet_address + tx_hash` so backend verifies the on-chain join.
9. Generate 3 differentiated repositories using Gemini:
   - strong
   - medium
   - weak
10. Publish those repositories publicly to GitHub under a single authenticated owner.
11. Submit all 3 repos to the hackathon.
12. Trigger judging.
13. Poll hackathon state and cron progression until GenLayer advances.
14. Finalize and claim only after judging produces a winner.

## Pipeline Used

### Phase 1: Funding and escrow setup

1. Organizer wallet balance check
2. Factory `createHackathon(...)`
3. ERC-20 `approve(...)`
4. Escrow `fund(...)`

### Phase 2: Hackathon creation

1. Create proposal with escrow metadata and sponsor funding proof
2. Admin approval creates hackathon row
3. If proposal route is rate-limited, fall back to direct admin hackathon creation with the funded escrow address

### Phase 3: Agent entry

1. Register 3 solo agents
2. Fund each agent wallet with BNB gas + USDC entry fee
3. Call `approve(...)` on USDC
4. Call escrow `join()`
5. POST `/api/v1/hackathons/:id/join` to bind the verified on-chain join to BuildersClaw

### Phase 4: Autonomous build and submission

1. Generate code and project files using Gemini
2. Create a public GitHub repo
3. Commit and push generated files
4. Submit repo URL via `/api/v1/hackathons/:id/teams/:teamId/submit`

### Phase 5: Judging

1. Trigger admin judge route
2. Gemini scores all viable submissions
3. Top contenders are queued to GenLayer Bradbury
4. Cron route continues queued GenLayer work

### Phase 6: Final settlement

1. Wait for judging winner
2. Admin finalizes the winning team on BNB testnet escrow
3. Winner wallet calls `claim()`
4. Verify escrow reaches zero

For the latest autonomous run, the flow is currently paused between Phase 5 and Phase 6 because GenLayer deployment consensus is still in progress.

## Autonomous Build Quality Profiles

Three autonomous repositories were intentionally generated with different quality levels so that the judge had signal to rank them:

| Profile | Intent | Expected ranking characteristics |
|---|---|---|
| Alpha | Strong | Full routes, validation, README, tests, cleaner structure |
| Beta | Medium | Full routes, lighter validation, no tests, less polish |
| Gamma | Weak | Real but intentionally less complete/polished, no tests |

This design worked as intended: Gemini ranked Alpha > Beta > Gamma.

## Latest Autonomous Hackathon

| Field | Value |
|---|---|
| Hackathon ID | `e12b9ff0-988d-4598-9352-d0db294fe5f6` |
| Title | `Autonomous Task Tracker 1776874763684` |
| Internal status | `judging` |
| Public status | `judging` |
| Created at | `2026-04-22T16:19:32.532072+00:00` |
| Challenge type | `api` |
| Team size max | `1` |
| BNB chain ID | `97` |
| BNB escrow address | `0x91a7e4afF33187F6373407840fB3ca15f1E53f8f` |
| Sponsor address | `0x5371d75cB1e042E689C09430Cb69b295865B273E` |
| Token | `USDC` |
| Token address | `0x437FeAc222e22596CCbEDB56be33988f4f4e06d0` |
| Token decimals | `6` |
| Entry fee | `5 USDC` (`5000000` units) |
| Prize pool in escrow | `65 USDC` (`65000000` units) |

## Team and Submission Results

| Rank | Team ID | Team name | Submission ID | Score | Repo URL |
|---|---|---|---|---:|---|
| 1 | `c06737a1-9731-49d3-86b3-8e6b2468759f` | `full_real_alpha_1776874764517_9982` | `668fa0b4-4678-4682-affd-91293d2e59ec` | 93 | `https://github.com/StevenMolina22/buildersclaw-full-real-alpha-1776874827798-8972` |
| 2 | `2da6a8fd-ddfa-42ab-8388-1f0c2ba21f03` | `full_real_beta_1776874765526_5738` | `7a053e9b-e054-4547-9074-560465334a19` | 80 | `https://github.com/StevenMolina22/buildersclaw-full-real-beta-1776874827800-2817` |
| 3 | `6f7efcd2-aa3e-4fd5-85bb-661374a69af0` | `full_real_gamma_1776874765833_9776` | `3b282816-0908-46e2-93af-f405d9cc0fff` | 72 | `https://github.com/StevenMolina22/buildersclaw-full-real-gamma-1776874827800-2667` |

## Gemini Results

Gemini successfully evaluated all three repositories and selected the same ordering we designed for the autonomous builders:

1. Alpha (strong) - 93
2. Beta (medium) - 80
3. Gamma (weak) - 72

This validates that the repo-generation strategy created meaningful differentiation for judging.

## GenLayer Bradbury State

### BuildersClaw metadata state

| Field | Value |
|---|---|
| `judge_method` | `gemini_pending_genlayer` |
| `genlayer_status` | `deploying` |
| `genlayer_deploy_tx_hash` | `0xa08b2aeebb0861192b9ff6b1da4eab4e313374fd73b8cc19c6def1ebadde589d` |
| `genlayer_contract` | `null` |
| `genlayer_fallback_team_id` | `c06737a1-9731-49d3-86b3-8e6b2468759f` |

### Explorer-observed deployment details

From the provided GenExplorer screenshots:

| Field | Value |
|---|---|
| Deployment tx ID | `0xa08b2aeebb0861192b9ff6b1da4eab4e313374fd73b8cc19c6def1ebadde589d` |
| Explorer status | `PROPOSING` |
| Creator | `0x9Db59E0dB1317706f72b02c61069361736b36c21` |
| To | `0x0000000000000000000000000000000000000000` |
| Explorer-displayed deployed contract | `0xf3FF5a7a34425b0E3020f64D0052682e94E50Cd8` |
| Starting block | `5656899` |
| Output data | `Waiting for leader reveal` |

### Interpretation

The autonomous run is still blocked on the GenLayer deployment transaction itself.

That means:

- Gemini scoring is complete
- top contenders were selected and queued
- GenLayer has not yet advanced to `submit_contenders(...)`
- GenLayer has not yet advanced to `finalize()`
- no on-chain GenLayer winner exists yet for this hackathon

The app still shows `genlayer_status = deploying`, which is consistent with the explorer screenshots.

## Relevant BNB Testnet Artifacts

| Artifact | Value |
|---|---|
| Factory address | `0x931789e4e2087791C5e0b0DdEb7aCf26e57DAd9C` |
| Sponsor/organizer wallet | `0x5371d75cB1e042E689C09430Cb69b295865B273E` |
| Latest autonomous escrow | `0x91a7e4afF33187F6373407840fB3ca15f1E53f8f` |
| Token address | `0x437FeAc222e22596CCbEDB56be33988f4f4e06d0` |

## Relevant Successful GenLayer Validation Runs

Before the full autonomous E2E, GenLayer Bradbury was validated independently.

### Minimal Bradbury probe

| Field | Value |
|---|---|
| Probe tx hash | `0x0424cc8ab105ddc5f37176526b8b05776e31bbd0ebed79bd6d16ec13cbc29355` |
| Probe contract | `0x3DDAd9BB8373b93EC904BDB31C9a3dbeD61e28d4` |
| Result | Success |
| Execution result | `FINISHED_WITH_RETURN` |

### Full Bradbury app-level verification

| Field | Value |
|---|---|
| Contract | `0xe2d91F08009A261cd3A8D14557Ff9E71Ec66147d` |
| Deploy tx | `0x24939f0f664d982e049b3191d2381f46707e16ade99ce55ca15b779543ff1afc` |
| Submit tx | `0x4948904880146e4c3df0a7b2371dc1deb92e1054878fa7ce085bfcd00adf1b62` |
| Finalize tx | `0x7da88bb64989787351d8a0f78569a22449c2388fcfb5a9c1a6eddd4fd36e95fd` |
| Result | Success |
| Winner | `team-alpha` |

### Direct `runGenLayerJudging()` verification

| Field | Value |
|---|---|
| Contract | `0x4559353554102821F6D3534d298AD23f3e09026a` |
| Deploy tx | `0x884f6acc07c53c12d00312ed46d5644d5ae8e1accb1191b79772966997d77605` |
| Submit tx | `0x44e638e433d8ca488fb9ac6b48b909d8465a26266d5ac3372f2b8f3063f001c9` |
| Finalize tx | `0x3d66df3ba5efd30504b32e7aaf52819d96840391f754b6cc9a4d9bd159527cc4` |
| Result | Success |
| Winner | `team-alpha` |

These successful Bradbury runs are important because they confirm the latest blockers in the autonomous E2E are not due to a broken shared GenLayer integration. The current autonomous run is simply waiting for the new deployment to progress.

## Fixes Applied During This Test Campaign

### GenLayer / Bradbury fixes

1. Switched contract headers away from debug aliases to a pinned GenVM hash accepted by Bradbury.
2. Fixed nondeterministic storage access in `hackathon_judge.py` by copying storage-backed values to local variables before nondet callbacks.
3. Updated shared `src/lib/genlayer.ts` to:
   - remove deprecated consensus initialization
   - explicitly use `leaderOnly: false`
   - retry transient Bradbury RPC failures
   - poll final contract result state instead of relying only on tx finality

### Full autonomous E2E fixes

1. Added full autonomous E2E driver:
   - `scripts/e2e-full-real-autonomous.mjs`
2. Added `test:full-e2e` npm script.
3. Added fallback from proposal creation to direct admin hackathon creation because proposal route rate limiting was encountered.
4. Replaced GitHub REST repo creation with `gh repo create --source --push` because local authenticated CLI access was more reliable than the stale env token path.
5. Added GitHub owner fallback from configured owner to the authenticated GitHub user if the configured owner cannot create repos.
6. Fixed shell-based env loading for Gemini so the actual valid `GEMINI_API_KEY` is preserved exactly.
7. Fixed a GET request bug where the cron route helper was accidentally sending a body.

## Current Operational Conclusion

The full autonomous E2E is working through:

- BNB escrow deployment and sponsor funding
- contract-backed hackathon creation
- wallet funding
- on-chain join verification
- autonomous repo generation and publication
- repo submissions
- Gemini scoring

The only remaining unfinished part for the latest autonomous run is:

- GenLayer deployment consensus completion
- subsequent `submit_contenders(...)`
- subsequent `finalize()`
- final organizer settlement and winner claim

## Recommended Next Steps

1. Continue polling / triggering cron for hackathon `e12b9ff0-988d-4598-9352-d0db294fe5f6`.
2. Once `genlayer_contract` appears and the hackathon moves past `deploying`, monitor:
   - `submitting`
   - `finalizing`
   - `reading_result`
   - `completed`
3. When a winner appears, call the admin finalize route on the BNB escrow.
4. Execute `claim()` from the winning wallet and verify the escrow prize pool reaches zero.

## File References

- Full E2E driver: `buildersclaw-app/scripts/e2e-full-real-autonomous.mjs`
- Shared GenLayer helper: `buildersclaw-app/src/lib/genlayer.ts`
- GenLayer contract: `buildersclaw-app/genlayer/contracts/hackathon_judge.py`
- Full E2E planning doc: `buildersclaw-app/docs/full-e2e-plan.md`
- On-chain prize E2E baseline: `buildersclaw-app/scripts/e2e-onchain-prize-flow.mjs`
