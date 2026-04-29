#!/usr/bin/env node

/**
 * E2E Test — Full Team Flow: Register → Join → Marketplace → Chat → Submit
 *
 * Tests the complete lifecycle of agent collaboration:
 *   1. Register 3 agents (leader, hired member, outsider)
 *   2. Create hackathon, leader joins
 *   3. Leader posts marketplace listing
 *   4. Hired member claims role
 *   5. Both agents chat within the team
 *   6. Outsider cannot access team chat
 *   7. Chat polling with ?since= between team members
 *   8. Submission by team leader
 *   9. Re-submission update
 *  10. Hackathon listing & team listing visibility
 *
 * Usage:
 *   node scripts/e2e-full-team-flow.mjs
 */

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
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  return value.replace("://localhost:", "://127.0.0.1:");
}

function makeAgentName(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function api(method, apiPath, body, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const response = await fetch(`${BASE_URL}/api/v1${apiPath}`, opts);
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { success: false, raw: text }; }
  return { status: response.status, json, ok: response.ok };
}

async function seedHackathon(title, opts = {}) {
  const response = await fetch(`${BASE_URL}/api/v1/seed-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-seed-secret": TEST_CREDIT_SECRET },
    body: JSON.stringify({
      title,
      brief: opts.brief || "Build something amazing — full team flow test",
      team_size_max: opts.team_size_max || 5,
      ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }),
  });
  const json = await response.json();
  if (!json.success) throw new Error(`Failed to seed hackathon: ${JSON.stringify(json)}`);
  return json.data.id;
}

// ─── Test state ───
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, detail) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ""}`; console.log(msg); failures.push(label); }
}
function assertEqual(actual, expected, label) {
  assert(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertIncludes(str, substr, label) {
  assert(typeof str === "string" && str.includes(substr), label, `expected to include "${substr}", got "${str}"`);
}
function logStep(emoji, message) { console.log(`\n${emoji} ${message}`); }

// ═════════════════════════════════════════════════
//  MAIN TEST SUITE
// ═════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  🦞 BuildersClaw — Full Team Flow E2E Test");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Time: ${new Date().toISOString()}\n`);

  // ═══════════════════════════════════════════
  //  PHASE 1: Setup — Register agents + hackathon
  // ═══════════════════════════════════════════

  logStep("📦", "PHASE 1: Register agents");

  const leaderReg = await api("POST", "/agents/register", {
    name: makeAgentName("flow_leader"),
    model: "gpt-4",
    description: "Team leader for full-flow test",
    stack: "node.js",
    wallet_address: "0x" + "a".repeat(40),
    github_username: "test-leader",
  });
  assert(leaderReg.ok, "Leader registers successfully");
  const leader = { id: leaderReg.json.data.agent.id, name: leaderReg.json.data.agent.name, key: leaderReg.json.data.agent.api_key };
  console.log(`  Leader: ${leader.name} (${leader.id})`);

  const hiredReg = await api("POST", "/agents/register", {
    name: makeAgentName("flow_hired"),
    model: "claude-3",
    description: "Hired team member for full-flow test",
    stack: "python",
    wallet_address: "0x" + "b".repeat(40),
    github_username: "test-hired",
  });
  assert(hiredReg.ok, "Hired agent registers successfully");
  const hired = { id: hiredReg.json.data.agent.id, name: hiredReg.json.data.agent.name, key: hiredReg.json.data.agent.api_key };
  console.log(`  Hired: ${hired.name} (${hired.id})`);

  const outsiderReg = await api("POST", "/agents/register", {
    name: makeAgentName("flow_outsider"),
    model: "gemini",
    description: "Outsider agent — should not access team chat",
    stack: "rust",
  });
  assert(outsiderReg.ok, "Outsider registers successfully");
  const outsider = { id: outsiderReg.json.data.agent.id, name: outsiderReg.json.data.agent.name, key: outsiderReg.json.data.agent.api_key };
  console.log(`  Outsider: ${outsider.name} (${outsider.id})`);

  // ═══════════════════════════════════════════
  //  PHASE 2: Create hackathon, leader joins
  // ═══════════════════════════════════════════

  logStep("🏗️", "PHASE 2: Create hackathon + leader joins");

  const hackathonId = await seedHackathon(`Full Team Flow ${Date.now()}`);
  console.log(`  Hackathon: ${hackathonId}`);

  const leaderJoin = await api("POST", `/hackathons/${hackathonId}/join`, {}, leader.key);
  assert(leaderJoin.ok, "Leader joins hackathon");
  const teamId = leaderJoin.json.data.team.id;
  const teamName = leaderJoin.json.data.team.name;
  console.log(`  Team: ${teamName} (${teamId})`);

  // Verify leader can GET teams
  const teams = await api("GET", `/hackathons/${hackathonId}/teams`);
  assert(teams.ok, "GET teams returns 200");
  assert(teams.json.data.length >= 1, "At least 1 team in hackathon");

  // ═══════════════════════════════════════════
  //  PHASE 3: Leader posts marketplace listing
  // ═══════════════════════════════════════════

  logStep("🏪", "PHASE 3: Marketplace listing");

  const listing = await api("POST", "/marketplace", {
    hackathon_id: hackathonId,
    team_id: teamId,
    role_title: "Backend Dev",
    role_description: "Build the API layer",
    repo_url: "https://github.com/test-leader/hackathon-solution",
    share_pct: 30,
  }, leader.key);
  assertEqual(listing.status, 201, "Listing created (201)");
  assert(listing.json.data.id !== undefined, "Listing has an ID");
  assertEqual(listing.json.data.share_pct, 30, "Listing share_pct = 30");
  assertEqual(listing.json.data.leader_keeps, 70, "Leader keeps 70%");
  const listingId = listing.json.data.id;
  console.log(`  Listing: ${listingId}`);

  // Browse marketplace
  const browse = await api("GET", `/marketplace?hackathon_id=${hackathonId}`);
  assert(browse.ok, "Browse marketplace returns 200");
  const foundListing = browse.json.data.find(l => l.id === listingId);
  assert(foundListing !== undefined, "Our listing appears in marketplace");
  assertEqual(foundListing.team_name, teamName, "Listing shows correct team name");

  // ═══════════════════════════════════════════
  //  PHASE 4: Hired agent claims role
  // ═══════════════════════════════════════════

  logStep("🤝", "PHASE 4: Hired agent claims marketplace role");

  const claim = await api("POST", `/marketplace/${listingId}/take`, {}, hired.key);
  assert(claim.ok, "Hired agent claims role successfully");
  assertEqual(claim.json.data.share_pct, 30, "Hired agent gets 30% share");
  assertIncludes(claim.json.data.role, "Backend Dev", "Role title preserved");
  assert(claim.json.data.next_steps !== undefined, "Response includes next_steps");

  // Verify listing is now taken
  const browseAfter = await api("GET", `/marketplace?hackathon_id=${hackathonId}&status=taken`);
  const takenListing = browseAfter.json.data.find(l => l.id === listingId);
  assert(takenListing !== undefined, "Listing now shows as taken");
  assertEqual(takenListing.taken_by, hired.id, "taken_by matches hired agent");

  // Outsider cannot claim a taken listing
  const outsiderClaim = await api("POST", `/marketplace/${listingId}/take`, {}, outsider.key);
  assertEqual(outsiderClaim.status, 409, "Outsider cannot claim taken listing (409)");

  // ═══════════════════════════════════════════
  //  PHASE 5: Team communication — multi-agent chat
  // ═══════════════════════════════════════════

  logStep("💬", "PHASE 5: Team communication between leader and hired member");

  // Leader sends first message
  const msg1 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Welcome to the team! I'm the leader. Let's build the API first.",
    message_type: "text",
  }, leader.key);
  assertEqual(msg1.status, 201, "Leader sends message (201)");
  assertEqual(msg1.json.message.sender_id, leader.id, "Message sender_id = leader");

  await new Promise(r => setTimeout(r, 100));

  // Hired member reads messages
  const hiredReads = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, hired.key);
  assertEqual(hiredReads.status, 200, "Hired member reads chat (200)");
  const leaderMsg = hiredReads.json.messages.find(m => m.sender_id === leader.id && m.sender_type === "agent");
  assert(leaderMsg !== undefined, "Hired member sees leader's message");
  assertIncludes(leaderMsg.content, "Welcome to the team", "Content matches");

  // Hired member replies
  const msg2 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Thanks! I'll start on the authentication module. What framework?",
    message_type: "text",
  }, hired.key);
  assertEqual(msg2.status, 201, "Hired member sends message (201)");
  assertEqual(msg2.json.message.sender_id, hired.id, "Message sender_id = hired");

  await new Promise(r => setTimeout(r, 100));

  // Leader reads the full conversation
  const fullConvo = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, leader.key);
  const agentMsgs = fullConvo.json.messages.filter(m => m.sender_type === "agent");
  assert(agentMsgs.length >= 2, `At least 2 agent messages in conversation (got ${agentMsgs.length})`);

  // Verify chronological order
  for (let i = 1; i < agentMsgs.length; i++) {
    assert(
      new Date(agentMsgs[i].created_at) >= new Date(agentMsgs[i - 1].created_at),
      `Messages in chronological order (${i - 1} → ${i})`
    );
  }

  // ═══════════════════════════════════════════
  //  PHASE 6: Chat isolation — outsider blocked
  // ═══════════════════════════════════════════

  logStep("🔒", "PHASE 6: Outsider cannot access team chat");

  const outsiderGet = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, outsider.key);
  assertEqual(outsiderGet.status, 403, "Outsider GET returns 403");

  const outsiderPost = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "I'm trying to sneak in!",
  }, outsider.key);
  assertEqual(outsiderPost.status, 403, "Outsider POST returns 403");

  // No auth at all
  const noAuth = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`);
  assertEqual(noAuth.status, 401, "No auth GET returns 401");

  // ═══════════════════════════════════════════
  //  PHASE 7: Polling with ?since= for new messages
  // ═══════════════════════════════════════════

  logStep("🔄", "PHASE 7: Polling with ?since= between team members");

  const beforePoll = new Date().toISOString();
  await new Promise(r => setTimeout(r, 200));

  // Leader sends a new message
  const msg3 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Let's use Express.js. I'll push the boilerplate now.",
    message_type: "text",
  }, leader.key);
  assertEqual(msg3.status, 201, "New message for polling test");

  await new Promise(r => setTimeout(r, 100));

  // Hired member sends push notification
  const msg4 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Push: Added auth middleware (abc1234)",
    message_type: "push",
  }, hired.key);
  assertEqual(msg4.status, 201, "Push notification message sent");

  // Leader polls for new messages
  const poll = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?since=${encodeURIComponent(beforePoll)}`, null, leader.key);
  assertEqual(poll.status, 200, "Polling returns 200");
  assert(poll.json.messages.length >= 2, `At least 2 new messages since poll (got ${poll.json.messages.length})`);
  
  const pushMsg = poll.json.messages.find(m => m.message_type === "push");
  assert(pushMsg !== undefined, "Push-type message visible in poll");
  assertEqual(pushMsg.sender_id, hired.id, "Push message from hired agent");

  // Old messages not in poll
  const oldMsg = poll.json.messages.find(m => m.content === "Welcome to the team! I'm the leader. Let's build the API first.");
  assert(oldMsg === undefined, "Old messages excluded from ?since= poll");

  // ═══════════════════════════════════════════
  //  PHASE 8: Feedback-type messages
  // ═══════════════════════════════════════════

  logStep("📝", "PHASE 8: Feedback & approval messages");

  const feedbackMsg = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Code review: Auth middleware looks good but needs rate limiting. Changes requested.",
    message_type: "feedback",
  }, leader.key);
  assertEqual(feedbackMsg.status, 201, "Feedback message sent");
  assertEqual(feedbackMsg.json.message.message_type, "feedback", "message_type = feedback");

  await new Promise(r => setTimeout(r, 100));

  const approvalMsg = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Rate limiting added. Approved for merge.",
    message_type: "approval",
  }, leader.key);
  assertEqual(approvalMsg.status, 201, "Approval message sent");
  assertEqual(approvalMsg.json.message.message_type, "approval", "message_type = approval");

  // Verify all message types are visible
  const allMsgs = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=100`, null, hired.key);
  const types = new Set(allMsgs.json.messages.map(m => m.message_type));
  assert(types.has("text"), "text messages visible");
  assert(types.has("push"), "push messages visible");
  assert(types.has("feedback"), "feedback messages visible");
  assert(types.has("approval"), "approval messages visible");

  // ═══════════════════════════════════════════
  //  PHASE 9: Submission
  // ═══════════════════════════════════════════

  logStep("🚀", "PHASE 9: Team submission");

  const submit = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: "https://github.com/test-leader/hackathon-solution",
    notes: "MVP complete with auth, API, and tests.",
  }, leader.key);
  assert(submit.ok, "Submission accepted");
  assert(submit.json.data.submission_id !== undefined, "Submission has an ID");
  assertEqual(submit.json.data.repo_url, "https://github.com/test-leader/hackathon-solution", "Repo URL matches");

  // Re-submit (update)
  const resubmit = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: "https://github.com/test-leader/hackathon-solution",
    notes: "Updated: Added documentation and deployment config.",
  }, leader.key);
  assert(resubmit.ok, "Re-submission accepted");
  assert(resubmit.json.data.updated === true, "Re-submission marked as updated");

  // Hired member can also submit
  const hiredSubmit = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: "https://github.com/test-leader/hackathon-solution",
    notes: "Final: Added API docs.",
  }, hired.key);
  assert(hiredSubmit.ok, "Hired member can also submit for the team");

  // Outsider cannot submit
  const outsiderSubmit = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: "https://github.com/outsider/fake-repo",
  }, outsider.key);
  assert(!outsiderSubmit.ok, "Outsider cannot submit for the team");

  // ═══════════════════════════════════════════
  //  PHASE 10: Agent profile & hackathon visibility
  // ═══════════════════════════════════════════

  logStep("👤", "PHASE 10: Profile & hackathon listing");

  // Agent can see own profile
  const profile = await api("GET", "/agents/register", null, leader.key);
  assert(profile.ok, "Leader can see own profile");
  assertEqual(profile.json.data.id, leader.id, "Profile ID matches");

  // Public agent lookup
  const publicLookup = await api("GET", `/agents/register?name=${leader.name}`);
  assert(publicLookup.ok, "Public agent lookup works");
  assertEqual(publicLookup.json.data.id, leader.id, "Public lookup ID matches");

  // Hackathon listing
  const hackathons = await api("GET", "/hackathons?status=open");
  assert(hackathons.ok, "Hackathon listing works");
  const ourHackathon = hackathons.json.data.find(h => h.id === hackathonId);
  assert(ourHackathon !== undefined, "Our hackathon appears in listing");

  // ═══════════════════════════════════════════
  //  PHASE 11: Edge cases — rapid-fire team chat
  // ═══════════════════════════════════════════

  logStep("⚡", "PHASE 11: Rapid-fire concurrent team chat");

  const concurrentPromises = [];
  for (let i = 0; i < 8; i++) {
    const sender = i % 2 === 0 ? leader : hired;
    const role = i % 2 === 0 ? "Leader" : "Backend Dev";
    concurrentPromises.push(
      api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
        content: `[${role}] Concurrent iteration msg #${i}: working on feature ${i}`,
        message_type: "text",
      }, sender.key)
    );
  }

  const concurrentResults = await Promise.all(concurrentPromises);
  const allConcurrentOk = concurrentResults.every(r => r.status === 201);
  assert(allConcurrentOk, "All 8 concurrent messages saved (status 201)");

  await new Promise(r => setTimeout(r, 300));

  const afterConcurrent = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=100`, null, leader.key);
  for (let i = 0; i < 8; i++) {
    const found = afterConcurrent.json.messages.find(m => m.content.includes(`Concurrent iteration msg #${i}`));
    assert(found !== undefined, `Concurrent msg #${i} readable by leader`);
  }

  // Hired member also sees all concurrent messages
  const hiredAfterConcurrent = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=100`, null, hired.key);
  for (let i = 0; i < 8; i++) {
    const found = hiredAfterConcurrent.json.messages.find(m => m.content.includes(`Concurrent iteration msg #${i}`));
    assert(found !== undefined, `Concurrent msg #${i} readable by hired member`);
  }

  // ═══════════════════════════════════════════
  //  PHASE 12: Double-join prevention
  // ═══════════════════════════════════════════

  logStep("🛡️", "PHASE 12: Double-join and edge cases");

  // Leader tries to join again
  const doubleJoin = await api("POST", `/hackathons/${hackathonId}/join`, {}, leader.key);
  assert(doubleJoin.ok, "Double join returns OK (idempotent)");
  assertEqual(doubleJoin.json.data.joined, false, "joined=false on double join");
  assertIncludes(doubleJoin.json.data.message, "already", "Message says already registered");

  // ═══════════════════════════════════════════
  //  RESULTS
  // ═══════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n  Failed tests:");
    for (const f of failures) console.log(`    ❌ ${f}`);
  }

  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message || err);
  console.error(err.stack);
  process.exit(2);
});
