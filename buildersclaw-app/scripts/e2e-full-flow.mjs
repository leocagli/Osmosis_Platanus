#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════
 * E2E Full Hackathon Flow — Multi-Agent with Marketplace Roles
 * ═══════════════════════════════════════════════════════════════════
 *
 * Simulates a REAL hackathon lifecycle from scratch:
 *
 *   1. Register 4 agents (Leader, Builder, Feedback Reviewer, Tester)
 *   2. Give them wallets + GitHub usernames
 *   3. Create a hackathon
 *   4. Leader joins → gets a team
 *   5. Leader posts 3 marketplace listings (builder, feedback, tester)
 *   6. Other agents claim the roles
 *   7. Team chat: coordinate architecture
 *   8. Builder "pushes" code (simulated) — chat notification
 *   9. Feedback Reviewer reviews — requests changes
 *  10. Builder iterates — pushes v2
 *  11. Feedback Reviewer approves
 *  12. Tester validates — posts test results
 *  13. Leader submits the repo
 *  14. Verify the full chat history has all interactions
 *  15. Verify team structure & share distribution
 *  16. Verify Telegram received messages
 *
 * Usage:
 *   node scripts/e2e-full-flow.mjs
 *
 * Requires:
 *   - Running dev server (pnpm dev) with TELEGRAM_BOT_TOKEN unset from system env
 *   - Env vars: ADMIN_API_KEY, TEST_CREDIT_SECRET
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

// ─── Load env ───
loadEnvFile(path.join(appRoot, ".env.local"));
loadEnvFile(path.join(appRoot, ".env"), { override: true });

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://localhost:3000");
const ADMIN_API_KEY = requiredEnv("ADMIN_API_KEY");
const TEST_CREDIT_SECRET = process.env.TEST_CREDIT_SECRET || ADMIN_API_KEY;

// ─── Helpers ───

function loadEnvFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (options.override || !(key in process.env)) process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing: ${name}`);
  return value;
}

function normalizeBaseUrl(v) { return v.replace("://localhost:", "://127.0.0.1:"); }

function uid() { return `${Date.now()}_${Math.floor(Math.random() * 10000)}`; }

async function api(method, apiPath, body, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}/api/v1${apiPath}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json, ok: res.ok };
}

async function seed(body) {
  const res = await fetch(`${BASE_URL}/api/v1/seed-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-seed-secret": TEST_CREDIT_SECRET },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Test infra ───
let passed = 0, failed = 0;
const failures = [];

function assert(cond, label, detail) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ""}`; console.log(msg); failures.push(label); }
}
function assertEqual(a, b, label) { assert(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertOk(res, label) { assert(res.ok, label, `status=${res.status} body=${JSON.stringify(res.json).slice(0, 200)}`); }
function step(emoji, msg) { console.log(`\n${emoji}  ${msg}`); }

// ─── Wallets (fake but valid format) ───
function fakeWallet(i) {
  return "0x" + crypto.createHash("sha256").update(`wallet_${i}_${Date.now()}`).digest("hex").slice(0, 40);
}

// ═══════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🦞 BuildersClaw — Full Hackathon Flow E2E Test");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  ${BASE_URL}  •  ${new Date().toISOString()}\n`);

  // ── Warm up server (ensure all routes are compiled) ──
  step("⏳", "Warming up server...");
  for (let i = 0; i < 3; i++) {
    const r = await api("GET", "/hackathons");
    if (r.ok) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log("  Server ready.");

  // ──────────────────────────────────────────────
  //  PHASE 1: Register 4 agents with full profiles
  // ──────────────────────────────────────────────
  step("👥", "PHASE 1 — Register agents");

  const agents = {};
  const roles = ["leader", "builder", "reviewer", "tester"];
  for (const role of roles) {
    const name = `e2e_${role}_${uid()}`;
    const reg = await api("POST", "/agents/register", {
      name, model: "gpt-4o", description: `E2E ${role} agent`, stack: "node.js",
    });
    assertOk(reg, `Register ${role}`);
    if (!reg.ok) throw new Error(`Failed to register ${role}: ${JSON.stringify(reg.json)}`);
    agents[role] = { id: reg.json.data.agent.id, name, key: reg.json.data.agent.api_key };
  }

  // Set wallets and github usernames
  for (const [role, agent] of Object.entries(agents)) {
    const wallet = fakeWallet(role);
    const patch = await api("PATCH", "/agents/register", {
      wallet_address: wallet,
      github_username: `gh_${role}_${uid()}`,
    }, agent.key);
    assertOk(patch, `${role} sets wallet + github`);
    agents[role].wallet = wallet;
  }

  console.log(`  Leader:   ${agents.leader.name}`);
  console.log(`  Builder:  ${agents.builder.name}`);
  console.log(`  Reviewer: ${agents.reviewer.name}`);
  console.log(`  Tester:   ${agents.tester.name}`);

  // ──────────────────────────────────────────────
  //  PHASE 2: Create hackathon
  // ──────────────────────────────────────────────
  step("🏆", "PHASE 2 — Create hackathon");

  const hackRes = await seed({
    title: `Full Flow Hack ${uid()}`,
    brief: "Build a landing page for an AI code review tool. Must include hero section, features grid, pricing, and a working contact form.",
    team_size_max: 4,
    prize_pool: 500,
    ends_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  });
  assert(hackRes.success, "Hackathon created");
  const hackathonId = hackRes.data.id;
  console.log(`  Hackathon: ${hackathonId}`);

  // ──────────────────────────────────────────────
  //  PHASE 3: Leader joins → gets a team
  // ──────────────────────────────────────────────
  step("🚀", "PHASE 3 — Leader joins hackathon");

  const joinRes = await api("POST", `/hackathons/${hackathonId}/join`, {}, agents.leader.key);
  assertOk(joinRes, "Leader joins hackathon");
  if (!joinRes.ok) throw new Error(`Leader join failed: ${JSON.stringify(joinRes.json)}`);
  const teamId = joinRes.json.data.team.id;
  const teamName = joinRes.json.data.team.name;
  console.log(`  Team: ${teamName} (${teamId})`);

  // Small delay for Telegram topic creation
  await new Promise(r => setTimeout(r, 2000));

  // ──────────────────────────────────────────────
  //  PHASE 4: Leader posts marketplace listings
  // ──────────────────────────────────────────────
  step("📋", "PHASE 4 — Leader posts marketplace roles");

  const repoUrl = "https://github.com/test-org/hackathon-landing-page";

  const listingConfigs = [
    { role_title: "🛠️ Builder", role_description: "Implement the landing page with React + TailwindCSS", share_pct: 25 },
    { role_title: "🔍 Feedback Reviewer", role_description: "Review each push, ensure quality and brief compliance", share_pct: 15 },
    { role_title: "🧪 QA Tester", role_description: "Write and run tests, validate all sections work", share_pct: 10 },
  ];

  const listings = {};
  for (const cfg of listingConfigs) {
    const listRes = await api("POST", "/marketplace", {
      hackathon_id: hackathonId,
      team_id: teamId,
      role_title: cfg.role_title,
      role_description: cfg.role_description,
      repo_url: repoUrl,
      share_pct: cfg.share_pct,
    }, agents.leader.key);
    assertOk(listRes, `Posted listing: ${cfg.role_title} @ ${cfg.share_pct}%`);
    listings[cfg.role_title] = listRes.json.data.id;
  }

  // Verify marketplace shows them
  const mktRes = await api("GET", `/marketplace?hackathon_id=${hackathonId}`);
  assertOk(mktRes, "Marketplace GET succeeds");
  assertEqual(mktRes.json.data.length, 3, "3 listings visible");

  // ──────────────────────────────────────────────
  //  PHASE 5: Agents claim marketplace roles
  // ──────────────────────────────────────────────
  step("🤝", "PHASE 5 — Agents claim roles");

  const claimMap = [
    { agent: "builder", listing: "🛠️ Builder" },
    { agent: "reviewer", listing: "🔍 Feedback Reviewer" },
    { agent: "tester", listing: "🧪 QA Tester" },
  ];

  for (const { agent: role, listing: title } of claimMap) {
    const claimRes = await api("POST", `/marketplace/${listings[title]}/take`, {}, agents[role].key);
    assertOk(claimRes, `${role} claims "${title}"`);
    console.log(`    ${agents[role].name} → ${title} (${claimRes.json.data?.share_pct}%)`);
  }

  // Verify marketplace listings are all taken
  const mktAfter = await api("GET", `/marketplace?hackathon_id=${hackathonId}&status=taken`);
  assertEqual(mktAfter.json.data?.length, 3, "All 3 listings are now 'taken'");

  // ──────────────────────────────────────────────
  //  PHASE 6: Verify team structure
  // ──────────────────────────────────────────────
  step("🏗️", "PHASE 6 — Verify team structure");

  const teamsRes = await api("GET", `/hackathons/${hackathonId}/teams`);
  assertOk(teamsRes, "Teams GET succeeds");
  const ourTeam = teamsRes.json.data?.find(t => t.id === teamId);
  assert(ourTeam !== undefined, "Our team exists in the list");
  assert(ourTeam?.members?.length === 4, `Team has 4 members (got ${ourTeam?.members?.length})`);

  // Verify share distribution
  if (ourTeam?.members) {
    const totalShare = ourTeam.members.reduce((sum, m) => sum + (m.revenue_share_pct || 0), 0);
    assertEqual(totalShare, 100, "Total share distribution = 100%");
    const leader = ourTeam.members.find(m => m.role === "leader");
    assertEqual(leader?.revenue_share_pct, 50, "Leader keeps 50% (100 - 25 - 15 - 10)");
  }

  // ──────────────────────────────────────────────
  //  PHASE 7: Team chat — coordinate
  // ──────────────────────────────────────────────
  step("💬", "PHASE 7 — Team coordination via chat");

  const chat = async (role, content, type = "text") => {
    const res = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
      content, message_type: type,
    }, agents[role].key);
    assert(res.status === 201, `${role} sends: "${content.slice(0, 50)}..."`, `status=${res.status}`);
    return res;
  };

  await chat("leader", "Welcome team! 🦞 Let's build this landing page. Brief: hero, features, pricing, contact form.");
  await chat("builder", "Roger! I'll set up Next.js + Tailwind. Starting with the hero section.");
  await chat("reviewer", "I'll review each push. Focus on brief compliance — all 4 sections must be present.");
  await chat("tester", "I'll prepare test cases: responsive design, form validation, accessibility checks.");
  await chat("leader", "Great. Builder: push when hero section is done. Reviewer gates the loop.");

  // ──────────────────────────────────────────────
  //  PHASE 8: Iteration Round 1 — Builder pushes v1
  // ──────────────────────────────────────────────
  step("🔨", "PHASE 8 — Build iteration round 1 (v1)");

  await chat("builder", "Push #1: Hero section with animated gradient background + CTA. Features grid with 6 cards.", "push");
  await new Promise(r => setTimeout(r, 200));

  // Reviewer reviews and requests changes
  await chat("reviewer", "Review of Push #1:\n✅ Hero section looks great, CTA is clear\n❌ Features grid only has 4 cards, brief says 6\n❌ No pricing section yet\n❌ No contact form\n\nVerdict: CHANGES REQUESTED — need all 4 sections before approval.", "feedback");

  await chat("builder", "Got it. Working on pricing table + contact form + adding 2 more feature cards.");

  // ──────────────────────────────────────────────
  //  PHASE 9: Iteration Round 2 — Builder pushes v2
  // ──────────────────────────────────────────────
  step("🔨", "PHASE 9 — Build iteration round 2 (v2)");

  await chat("builder", "Push #2: Added pricing section (3 tiers), contact form with validation, 6 feature cards now complete.", "push");
  await new Promise(r => setTimeout(r, 200));

  // Reviewer reviews again
  await chat("reviewer", "Review of Push #2:\n✅ All 4 sections present (hero, features, pricing, contact)\n✅ 6 feature cards ✓\n✅ Pricing has 3 tiers ✓\n✅ Contact form with validation ✓\n⚠️ Minor: mobile responsiveness could be better on pricing cards\n\nVerdict: CHANGES REQUESTED — fix mobile layout then we're good.", "feedback");

  await chat("builder", "Quick fix incoming — adjusting grid breakpoints for mobile.");

  // ──────────────────────────────────────────────
  //  PHASE 10: Iteration Round 3 — Builder pushes v3 (final)
  // ──────────────────────────────────────────────
  step("🔨", "PHASE 10 — Build iteration round 3 (v3 — final)");

  await chat("builder", "Push #3: Mobile responsive pricing cards, added smooth scroll, optimized images.", "push");
  await new Promise(r => setTimeout(r, 200));

  // Reviewer approves!
  await chat("reviewer", "Review of Push #3:\n✅ All sections present and complete\n✅ Mobile responsiveness perfect\n✅ Smooth scroll working\n✅ Brief compliance: 100%\n\n🎉 APPROVED — ready to submit!", "approval");

  // ──────────────────────────────────────────────
  //  PHASE 11: Tester validates
  // ──────────────────────────────────────────────
  step("🧪", "PHASE 11 — QA Testing");

  await chat("tester", "Running test suite...\n\n✅ Hero section renders correctly\n✅ Features grid: 6 cards responsive\n✅ Pricing: 3 tiers, toggle works\n✅ Contact form: validation, submission\n✅ Mobile: all breakpoints pass\n✅ Accessibility: all ARIA labels present\n✅ Performance: LCP < 2.5s\n\n7/7 tests passing. Ready to ship! 🚀", "text");

  // ──────────────────────────────────────────────
  //  PHASE 12: Leader submits
  // ──────────────────────────────────────────────
  step("📦", "PHASE 12 — Submit to hackathon");

  await chat("leader", "All checks passed. Submitting now! Good luck team 🦞🚀");

  const submitRes = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: repoUrl,
    notes: "Landing page with hero, features (6), pricing (3 tiers), and contact form. All tests passing. Mobile responsive.",
  }, agents.leader.key);
  assertOk(submitRes, "Submission accepted");
  assertEqual(submitRes.json.data?.status, "completed", "Submission status is 'completed'");
  assertEqual(submitRes.json.data?.repo_url, repoUrl, "Repo URL matches");
  console.log(`  Submission ID: ${submitRes.json.data?.submission_id}`);

  // ──────────────────────────────────────────────
  //  PHASE 13: Verify full chat history
  // ──────────────────────────────────────────────
  step("📜", "PHASE 13 — Verify complete chat history");

  const historyRes = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=100`, null, agents.leader.key);
  assertOk(historyRes, "Chat history GET succeeds");
  const messages = historyRes.json.messages || [];
  console.log(`  Total messages: ${messages.length}`);

  // Count by type
  const byType = {};
  for (const m of messages) {
    byType[m.message_type] = (byType[m.message_type] || 0) + 1;
  }
  console.log(`  By type: ${JSON.stringify(byType)}`);

  assert(messages.length >= 14, `At least 14 agent messages (got ${messages.length})`);
  assert((byType.push || 0) >= 3, `At least 3 push messages (got ${byType.push || 0})`);
  assert((byType.feedback || 0) >= 2, `At least 2 feedback messages (got ${byType.feedback || 0})`);
  assert((byType.approval || 0) >= 1, `At least 1 approval message (got ${byType.approval || 0})`);

  // Count by sender
  const bySender = {};
  for (const m of messages) {
    if (m.sender_type === "agent") bySender[m.sender_name] = (bySender[m.sender_name] || 0) + 1;
  }
  console.log(`  By sender: ${JSON.stringify(bySender)}`);
  assert(Object.keys(bySender).length >= 4, `All 4 agents sent messages (got ${Object.keys(bySender).length})`);

  // Verify chronological order
  for (let i = 1; i < messages.length; i++) {
    const ok = new Date(messages[i].created_at) >= new Date(messages[i - 1].created_at);
    if (!ok) { assert(false, `Message ${i} is chronologically ordered`); break; }
  }
  assert(true, "All messages in chronological order");

  // Verify reviewer's approval is after pushes
  const approvalMsg = messages.find(m => m.message_type === "approval");
  const lastPush = messages.filter(m => m.message_type === "push").pop();
  if (approvalMsg && lastPush) {
    assert(new Date(approvalMsg.created_at) > new Date(lastPush.created_at), "Approval comes after last push");
  }

  // ──────────────────────────────────────────────
  //  PHASE 14: Verify building visualization
  // ──────────────────────────────────────────────
  step("🏢", "PHASE 14 — Verify building visualization");

  const buildingRes = await api("GET", `/hackathons/${hackathonId}/building`);
  assertOk(buildingRes, "Building GET succeeds");
  const floors = buildingRes.json.data?.floors || [];
  const ourFloor = floors.find(f => f.team_id === teamId);
  assert(ourFloor !== undefined, "Our team has a floor");
  assertEqual(ourFloor?.lobsters?.length, 4, "Floor shows 4 lobsters");
  assertEqual(ourFloor?.status, "submitted", "Floor status is 'submitted'");

  // ──────────────────────────────────────────────
  //  PHASE 15: Verify activity log
  // ──────────────────────────────────────────────
  step("📊", "PHASE 15 — Verify activity log");

  const activityRes = await api("GET", `/hackathons/${hackathonId}/activity?limit=50`);
  assertOk(activityRes, "Activity GET succeeds");
  const events = activityRes.json.data || [];
  const eventTypes = events.map(e => e.event_type);
  console.log(`  Events: ${eventTypes.join(", ")}`);

  assert(eventTypes.includes("submission_received"), "Activity has submission_received");
  assert(eventTypes.includes("marketplace_role_claimed"), "Activity has marketplace_role_claimed");
  assert(eventTypes.includes("marketplace_listing_posted"), "Activity has marketplace_listing_posted");

  // ──────────────────────────────────────────────
  //  PHASE 16: Cross-agent isolation
  // ──────────────────────────────────────────────
  step("🔒", "PHASE 16 — Verify chat isolation");

  // Register an outsider agent
  const outsiderReg = await api("POST", "/agents/register", {
    name: `e2e_outsider_${uid()}`, model: "test", description: "outsider",
  });
  assertOk(outsiderReg, "Outsider registered");

  // Outsider can't read team chat
  const outsiderGet = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, outsiderReg.json.data.agent.api_key);
  assertEqual(outsiderGet.status, 403, "Outsider cannot read team chat");

  // Outsider can't post to team chat
  const outsiderPost = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "I shouldn't be here",
  }, outsiderReg.json.data.agent.api_key);
  assertEqual(outsiderPost.status, 403, "Outsider cannot post to team chat");

  // ──────────────────────────────────────────────
  //  PHASE 17: Polling — since parameter
  // ──────────────────────────────────────────────
  step("🔄", "PHASE 17 — Polling with ?since=");

  const beforeFinal = new Date().toISOString();
  await new Promise(r => setTimeout(r, 200));
  await chat("leader", "Final message after timestamp for polling test!");

  const pollRes = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?since=${encodeURIComponent(beforeFinal)}`, null, agents.leader.key);
  assertOk(pollRes, "Polling GET succeeds");
  const newMsgs = pollRes.json.messages || [];
  assert(newMsgs.length >= 1, `Polling returns new message(s) (got ${newMsgs.length})`);
  const found = newMsgs.find(m => m.content.includes("Final message after timestamp"));
  assert(found !== undefined, "New message found in polling results");

  // ══════════════════════════════════════════════
  //  RESULTS
  // ══════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n  Failed tests:");
    for (const f of failures) console.log(`    ❌ ${f}`);
  }

  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\n💥 FATAL:", err.message || err);
  console.error(err.stack);
  process.exit(2);
});
