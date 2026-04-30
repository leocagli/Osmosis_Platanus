// test-judging.mjs — End-to-end test for the GenLayer judging pipeline
// Usage: node scripts/test-judging.mjs
// Requires: local server running on :3000

const BASE = "http://localhost:3000/api/v1";
const ADMIN_KEY = "admin_4cf8b24f94b3195289839499bf8958de9134065fbf6e4f9668d6b5b25fbde0f1";
const SUPABASE_URL = "https://jltbinljziasruigovwd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsdGJpbmxqemlhc3J1aWdvdndkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA0OTg5NywiZXhwIjoyMDg5NjI1ODk3fQ.JphtXkmntm7FzJKoNuW4BOLL8gahlj2jMHdSxm92sUg";

const log  = (msg) => console.log(`\x1b[34m[>]\x1b[0m ${msg}`);
const ok   = (msg) => console.log(`\x1b[32m[✓]\x1b[0m ${msg}`);
const fail = (msg) => { console.error(`\x1b[31m[✗]\x1b[0m ${msg}`); process.exit(1); };

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

async function supabase(method, table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  BuildersClaw — GenLayer Judging E2E Test");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// ── 1. Create test agents directly in Supabase (bypasses API rate limit) ──
log("Creating test agents directly in Supabase...");

import crypto from "crypto";

const ts = Date.now();

function makeApiKey() {
  return `buildersclaw_${crypto.randomBytes(32).toString("hex")}`;
}
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const agents = [
  { name: `test_alpha_${ts}`, display_name: "Test Agent Alpha" },
  { name: `test_beta_${ts}`,  display_name: "Test Agent Beta"  },
  { name: `test_gamma_${ts}`, display_name: "Test Agent Gamma" },
];

const keys = [];
for (const ag of agents) {
  const key = makeApiKey();
  const res = await supabase("POST", "agents", {
    id: uuid(),
    name: ag.name,
    display_name: ag.display_name,
    api_key_hash: hashToken(key),
    model: "test",
    status: "active",
  });
  if (!res?.[0]?.id) fail(`Agent creation failed for ${ag.name}: ${JSON.stringify(res)}`);
  keys.push(key);
  ok(`Created: ${ag.name}`);
}

const [key1, key2, key3] = keys;

// ── 2. Create hackathon directly in Supabase ─────────────────────────────
log("Creating test hackathon...");

const hackId = uuid();
const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const hackRes = await supabase("POST", "hackathons", {
  id: hackId,
  title: `GenLayer Test Hackathon ${ts}`,
  brief: "Build a web app that shows real-time cryptocurrency prices using a public API. Requirements: display at least 5 cryptocurrencies, support sorting by price change, have a clean and responsive UI, and handle API errors gracefully. Bonus points for historical charts and portfolio tracking.",
  status: "open",
  entry_fee: 0,
  max_participants: 50,
  starts_at: new Date().toISOString(),
  ends_at: endsAt,
});

if (!hackRes?.[0]?.id) fail(`Hackathon creation failed: ${JSON.stringify(hackRes)}`);
ok(`Hackathon created: ${hackId}`);

// ── 3. Agents join ───────────────────────────────────────────────────────
log("Agents joining hackathon...");

const join1 = await api("POST", `/hackathons/${hackId}/join`, { name: "Team Alpha" }, key1);
const team1 = join1?.data?.team_id || join1?.data?.team?.id;
if (!team1) fail(`Agent 1 join failed: ${JSON.stringify(join1)}`);
ok(`Agent 1 joined → team: ${team1}`);

const join2 = await api("POST", `/hackathons/${hackId}/join`, { name: "Team Beta" }, key2);
const team2 = join2?.data?.team_id || join2?.data?.team?.id;
if (!team2) fail(`Agent 2 join failed: ${JSON.stringify(join2)}`);
ok(`Agent 2 joined → team: ${team2}`);

const join3 = await api("POST", `/hackathons/${hackId}/join`, { name: "Team Gamma" }, key3);
const team3 = join3?.data?.team_id || join3?.data?.team?.id;
if (!team3) fail(`Agent 3 join failed: ${JSON.stringify(join3)}`);
ok(`Agent 3 joined → team: ${team3}`);

// ── 4. Submit repos ──────────────────────────────────────────────────────
log("Submitting repos...");

// Small focused repos for fast judging
const sub1 = await api("POST", `/hackathons/${hackId}/teams/${team1}/submit`, {
  repo_url: "https://github.com/BuilderIO/micro-agent",
  notes: "AI coding agent that iteratively fixes failing tests. TypeScript + Node.js. Clean architecture, well documented.",
}, key1);
if (!sub1?.success) fail(`Agent 1 submission failed: ${JSON.stringify(sub1)}`);
ok("Agent 1 submitted repo");

const sub2 = await api("POST", `/hackathons/${hackId}/teams/${team2}/submit`, {
  repo_url: "https://github.com/anthropics/anthropic-quickstarts",
  notes: "Quickstart templates for Claude API. Python + TypeScript. Multiple working demos, good structure.",
}, key2);
if (!sub2?.success) fail(`Agent 2 submission failed: ${JSON.stringify(sub2)}`);
ok("Agent 2 submitted repo");

const sub3 = await api("POST", `/hackathons/${hackId}/teams/${team3}/submit`, {
  repo_url: "https://github.com/genlayerlabs/genlayer-studio",
  notes: "GenLayer Studio IDE. TypeScript + Vue. Smart contract development environment with debugging tools.",
}, key3);
if (!sub3?.success) fail(`Agent 3 submission failed: ${JSON.stringify(sub3)}`);
ok("Agent 3 submitted repo");

// ── 5. Trigger judging (fire-and-forget + poll) ──────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
log("Triggering AI judging (Gemini pre-filter → GenLayer consensus)...");
log("This takes 5-10 minutes. Grab a coffee ☕");
console.log(`  Hackathon ID: ${hackId}\n`);

// Fire judge request in background — don't await (server takes 5-10 min, undici headersTimeout=5min)
// We'll poll the hackathon status instead.
fetch(`${BASE}/admin/hackathons/${hackId}/judge`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${ADMIN_KEY}`, "Content-Type": "application/json" },
}).catch(() => {}); // intentionally ignore — we poll below

// Poll hackathon row in Supabase every 10 seconds until completed
log("Polling hackathon status every 10s (up to 10 minutes)...");
let judgeBody = null;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 10_000));
  const hackRow = await fetch(`${SUPABASE_URL}/rest/v1/hackathons?id=eq.${hackId}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).then(r => r.json()).catch(() => null);
  const h = hackRow?.[0];
  if (h?.status === "completed") {
    log(`Hackathon completed after ${(i+1)*10}s of polling`);
    judgeBody = { success: true, hackathon: h };
    break;
  }
  process.stdout.write(`.`);
}
if (!judgeBody) process.stdout.write("\n");

// Also fetch the leaderboard for display
if (judgeBody?.success) {
  const lb = await fetch(`${BASE}/hackathons/${hackId}/leaderboard`).then(r => r.json()).catch(() => null);
  judgeBody.leaderboard = lb?.data ?? lb?.leaderboard ?? null;
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  JUDGING RESULT");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (judgeBody?.success) {
  ok("JUDGING COMPLETE!");
  const h = judgeBody.hackathon ?? {};
  let meta = {};
  try { meta = typeof h.judging_criteria === "string" ? JSON.parse(h.judging_criteria) : (h.judging_criteria ?? {}); } catch { /* ignore */ }
  console.log(`  Winner team ID:    ${meta.winner_team_id ?? h.winner_team_id ?? "—"}`);
  console.log(`  GenLayer contract: ${meta.genlayer_contract ?? "none"}`);
  console.log(`  Judge method:      ${meta.judge_method ?? "—"}`);

  const leaderboard = judgeBody.leaderboard;
  if (leaderboard?.length) {
    console.log("\n━━━ LEADERBOARD ━━━");
    for (const entry of leaderboard) {
      const rank = entry.rank === 1 ? "1st" : entry.rank === 2 ? "2nd" : "3rd";
      console.log(`  ${rank} #${entry.rank} ${entry.team_name} — score: ${entry.total_score ?? entry.score ?? "?"}`);
    }
  }
} else {
  fail(`Judging did not complete within 10 minutes. Last status: ${JSON.stringify(judgeBody)}`);
}

console.log(`\n  Hackathon ID (for manual checks): ${hackId}\n`);
