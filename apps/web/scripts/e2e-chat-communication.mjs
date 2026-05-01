#!/usr/bin/env node

/**
 * E2E Test — Agent Chat & Communication System
 *
 * Tests the full lifecycle of agent-to-agent communication:
 *   - Chat POST/GET endpoints
 *   - Polling with ?since=
 *   - Message types, validation, edge cases
 *   - Auth & membership enforcement
 *   - Pagination (limit, before)
 *   - Telegram webhook ingestion
 *   - Webhook secret validation
 *   - Multi-agent conversation visibility
 *   - Chronological ordering
 *
 * Usage:
 *   node scripts/e2e-chat-communication.mjs
 *
 * Requires:
 *   - Running dev server (pnpm dev)
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
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "buildersclaw_tg_hook";

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
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { success: false, raw: text };
  }

  return { status: response.status, json, ok: response.ok };
}

async function rawFetch(method, fullUrl, body, headers = {}) {
  const opts = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body) opts.body = JSON.stringify(body);

  const response = await fetch(fullUrl, opts);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return { status: response.status, json, ok: response.ok };
}

// ─── Test state ───

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, detail) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ""}`;
    console.log(msg);
    failures.push(label);
  }
}

function assertEqual(actual, expected, label) {
  assert(
    actual === expected,
    label,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function assertIncludes(str, substr, label) {
  assert(
    typeof str === "string" && str.includes(substr),
    label,
    `expected to include "${substr}", got "${str}"`,
  );
}

function logStep(emoji, message) {
  console.log(`\n${emoji} ${message}`);
}

// ─── Register agents ───

async function registerAgent(name) {
  const res = await api("POST", "/agents/register", {
    name,
    model: "test-model",
    description: `Test agent ${name}`,
    stack: "node.js",
  });
  if (!res.ok) throw new Error(`Failed to register agent ${name}: ${JSON.stringify(res.json)}`);
  return {
    id: res.json.data.agent.id,
    name: res.json.data.agent.name,
    apiKey: res.json.data.agent.api_key,
  };
}

// ─── Seed hackathon ───

async function seedHackathon(title, opts = {}) {
  const res = await api("POST", "/seed-test", {
    title,
    brief: opts.brief || "Build something amazing — communication test",
    team_size_max: opts.team_size_max || 4,
    ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  }, undefined);

  // seed-test uses x-seed-secret header, not Bearer
  const response = await fetch(`${BASE_URL}/api/v1/seed-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seed-secret": TEST_CREDIT_SECRET,
    },
    body: JSON.stringify({
      title,
      brief: opts.brief || "Build something amazing — communication test",
      team_size_max: opts.team_size_max || 4,
      ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }),
  });

  const json = await response.json();
  if (!json.success) throw new Error(`Failed to seed hackathon: ${JSON.stringify(json)}`);
  return json.data.id;
}

// ─── Add member to team ───

async function addMemberToTeam(teamId, agentId, leaderId, sharePct = 20) {
  const response = await fetch(`${BASE_URL}/api/v1/seed-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seed-secret": TEST_CREDIT_SECRET,
    },
    body: JSON.stringify({
      action: "add_member",
      team_id: teamId,
      agent_id: agentId,
      leader_id: leaderId,
      share_pct: sharePct,
      role: "member",
    }),
  });

  const json = await response.json();
  if (!json.success) throw new Error(`Failed to add member: ${JSON.stringify(json)}`);
  return json;
}

// ═══════════════════════════════════════════
//  MAIN TEST SUITE
// ═══════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  🦞 BuildersClaw — Agent Communication E2E Tests");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Time: ${new Date().toISOString()}\n`);

  // ─── SETUP ───

  logStep("📦", "SETUP — Register agents and create hackathon");

  const agentAlpha = await registerAgent(makeAgentName("chat_alpha"));
  console.log(`  Agent Alpha: ${agentAlpha.name} (${agentAlpha.id})`);

  const agentBeta = await registerAgent(makeAgentName("chat_beta"));
  console.log(`  Agent Beta: ${agentBeta.name} (${agentBeta.id})`);

  const agentGamma = await registerAgent(makeAgentName("chat_gamma"));
  console.log(`  Agent Gamma (outsider): ${agentGamma.name} (${agentGamma.id})`);

  const hackathonId = await seedHackathon(`Chat Test ${Date.now()}`);
  console.log(`  Hackathon: ${hackathonId}`);

  // Alpha joins → gets a team
  const joinAlpha = await api("POST", `/hackathons/${hackathonId}/join`, {}, agentAlpha.apiKey);
  assert(joinAlpha.ok, "Alpha joins hackathon", JSON.stringify(joinAlpha.json));
  const teamId = joinAlpha.json.data.team.id;
  const teamName = joinAlpha.json.data.team.name;
  console.log(`  Team: ${teamName} (${teamId})`);

  // Beta joins separately → own team
  const joinBeta = await api("POST", `/hackathons/${hackathonId}/join`, {}, agentBeta.apiKey);
  assert(joinBeta.ok, "Beta joins hackathon");
  const teamBetaId = joinBeta.json.data.team.id;

  // Also add Beta to Alpha's team via seed (multi-agent team)
  await addMemberToTeam(teamId, agentBeta.id, agentAlpha.id, 25);
  console.log(`  Added Beta to Alpha's team`);

  // ════════════════════════════════════════════
  //  TEST 1: Basic POST — Agent sends a message
  // ════════════════════════════════════════════

  logStep("1️⃣", "TEST 1: Basic message POST");

  const msg1 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Hello team! Alpha here, ready to build.",
    message_type: "text",
  }, agentAlpha.apiKey);

  assertEqual(msg1.status, 201, "POST returns 201");
  assert(msg1.json.success === true, "POST returns success: true");
  assert(msg1.json.message !== undefined, "POST returns message object");
  assertEqual(msg1.json.message.sender_type, "agent", "sender_type is agent");
  assertEqual(msg1.json.message.sender_id, agentAlpha.id, "sender_id matches Alpha");
  assertIncludes(msg1.json.message.sender_name, agentAlpha.name, "sender_name includes agent name");
  assertEqual(msg1.json.message.message_type, "text", "message_type is text");
  assertEqual(msg1.json.message.content, "Hello team! Alpha here, ready to build.", "content matches");
  assert(msg1.json.message.id !== undefined, "message has an id");
  assert(msg1.json.message.created_at !== undefined, "message has created_at");

  // ════════════════════════════════════════════
  //  TEST 2: Basic GET — Read messages
  // ════════════════════════════════════════════

  logStep("2️⃣", "TEST 2: Basic message GET");

  const get1 = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, agentAlpha.apiKey);

  assertEqual(get1.status, 200, "GET returns 200");
  assert(get1.json.success === true, "GET returns success: true");
  assert(Array.isArray(get1.json.messages), "GET returns messages array");
  assert(get1.json.messages.length >= 1, "At least 1 message (the one we posted)");

  const firstUserMsg = get1.json.messages.find((m) => m.sender_type === "agent" && m.sender_id === agentAlpha.id);
  assert(firstUserMsg !== undefined, "Alpha's message is in the list");
  assertEqual(firstUserMsg.content, "Hello team! Alpha here, ready to build.", "Content matches in GET");

  // ════════════════════════════════════════════
  //  TEST 3: Beta reads Alpha's messages (same team)
  // ════════════════════════════════════════════

  logStep("3️⃣", "TEST 3: Beta reads Alpha's messages (cross-agent visibility)");

  const getBeta = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, agentBeta.apiKey);

  assertEqual(getBeta.status, 200, "Beta can GET from Alpha's team");
  const betaSeesAlpha = getBeta.json.messages.find((m) => m.sender_id === agentAlpha.id);
  assert(betaSeesAlpha !== undefined, "Beta sees Alpha's message");

  // ════════════════════════════════════════════
  //  TEST 4: Multi-agent conversation
  // ════════════════════════════════════════════

  logStep("4️⃣", "TEST 4: Multi-agent conversation (multiple messages)");

  // Small delay to ensure ordering
  await new Promise((r) => setTimeout(r, 100));

  const msg2 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Beta here! Let's coordinate the architecture.",
    message_type: "text",
  }, agentBeta.apiKey);
  assertEqual(msg2.status, 201, "Beta sends a message");

  await new Promise((r) => setTimeout(r, 100));

  const msg3 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "I'll start with the frontend components.",
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(msg3.status, 201, "Alpha replies");

  const getAll = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, agentAlpha.apiKey);
  assert(getAll.json.messages.length >= 3, `At least 3 user messages (got ${getAll.json.messages.length})`);

  // Verify chronological order
  const agentMsgs = getAll.json.messages.filter((m) => m.sender_type === "agent");
  for (let i = 1; i < agentMsgs.length; i++) {
    assert(
      new Date(agentMsgs[i].created_at) >= new Date(agentMsgs[i - 1].created_at),
      `Messages in chronological order (msg ${i - 1} → ${i})`,
    );
  }

  // ════════════════════════════════════════════
  //  TEST 5: Polling with ?since=
  // ════════════════════════════════════════════

  logStep("5️⃣", "TEST 5: Polling with ?since= parameter");

  // Record timestamp before sending new message
  const beforeNewMsg = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 200));

  const msg4 = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "New message after timestamp marker!",
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(msg4.status, 201, "New message posted for polling test");

  const pollResult = await api(
    "GET",
    `/hackathons/${hackathonId}/teams/${teamId}/chat?since=${encodeURIComponent(beforeNewMsg)}`,
    null,
    agentAlpha.apiKey,
  );

  assertEqual(pollResult.status, 200, "Polling GET returns 200");
  assert(pollResult.json.messages.length >= 1, `At least 1 new message since timestamp (got ${pollResult.json.messages.length})`);
  const newMsg = pollResult.json.messages.find((m) => m.content === "New message after timestamp marker!");
  assert(newMsg !== undefined, "New message appears in ?since= results");

  // Verify old messages are NOT in polling result
  const oldMsg = pollResult.json.messages.find((m) => m.content === "Hello team! Alpha here, ready to build.");
  assert(oldMsg === undefined, "Old messages are NOT in ?since= results");

  // ════════════════════════════════════════════
  //  TEST 6: All valid message_type values
  // ════════════════════════════════════════════

  logStep("6️⃣", "TEST 6: Valid message_type values");

  // Agent-allowed types → should return 201
  const agentAllowedTypes = ["text", "push", "feedback", "approval"];

  for (const mtype of agentAllowedTypes) {
    const res = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
      content: `Test message with type: ${mtype}`,
      message_type: mtype,
    }, agentAlpha.apiKey);
    assertEqual(res.status, 201, `message_type "${mtype}" accepted`);
    assertEqual(res.json.message.message_type, mtype, `message_type "${mtype}" stored correctly`);
  }

  // Platform-only types → agents get 403
  const platformOnlyTypes = ["submission", "system"];

  for (const mtype of platformOnlyTypes) {
    const res = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
      content: `Test message with type: ${mtype}`,
      message_type: mtype,
    }, agentAlpha.apiKey);
    assertEqual(res.status, 403, `message_type "${mtype}" is reserved (agents get 403)`);
    assertIncludes(res.json.error.message, "reserved", `Error explains "${mtype}" is reserved`);
  }

  // ════════════════════════════════════════════
  //  TEST 7: Invalid message_type
  // ════════════════════════════════════════════

  logStep("7️⃣", "TEST 7: Invalid message_type rejected");

  const invalidType = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Testing with bad type",
    message_type: "invalid_type",
  }, agentAlpha.apiKey);
  assertEqual(invalidType.status, 400, "Invalid message_type returns 400");
  assert(invalidType.json.success === false, "Returns success: false");
  assertIncludes(invalidType.json.error.message, "Invalid message_type", "Error mentions invalid type");

  // ════════════════════════════════════════════
  //  TEST 8: Empty content rejected
  // ════════════════════════════════════════════

  logStep("8️⃣", "TEST 8: Empty content rejected");

  const emptyContent = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "",
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(emptyContent.status, 400, "Empty content returns 400");
  assertIncludes(emptyContent.json.error.message, "content is required", "Error says content required");

  const whitespaceContent = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "   ",
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(whitespaceContent.status, 400, "Whitespace-only content returns 400");

  // ════════════════════════════════════════════
  //  TEST 9: Content too long (> 4000 chars)
  // ════════════════════════════════════════════

  logStep("9️⃣", "TEST 9: Content too long rejected (> 4000 chars)");

  const longContent = "x".repeat(4001);
  const tooLong = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: longContent,
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(tooLong.status, 400, "Content > 4000 chars returns 400");
  assertIncludes(tooLong.json.error.message, "too long", "Error mentions too long");

  // Exactly 4000 should be OK
  const exactLimit = "y".repeat(4000);
  const atLimit = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: exactLimit,
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(atLimit.status, 201, "Content exactly 4000 chars is accepted");

  // ════════════════════════════════════════════
  //  TEST 10: Invalid JSON body
  // ════════════════════════════════════════════

  logStep("🔟", "TEST 10: Invalid JSON body");

  const badJsonRes = await fetch(`${BASE_URL}/api/v1/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${agentAlpha.apiKey}`,
    },
    body: "this is not json{{{",
  });
  const badJsonBody = await badJsonRes.json();
  assertEqual(badJsonRes.status, 400, "Invalid JSON returns 400");
  assertIncludes(badJsonBody.error.message, "Invalid JSON", "Error mentions Invalid JSON");

  // ════════════════════════════════════════════
  //  TEST 11: Auth — No token
  // ════════════════════════════════════════════

  logStep("1️⃣1️⃣", "TEST 11: Auth — No token");

  const noAuth = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Should not work",
  }, null);
  assertEqual(noAuth.status, 401, "No auth returns 401");

  const noAuthGet = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, null);
  assertEqual(noAuthGet.status, 401, "GET without auth returns 401");

  // ════════════════════════════════════════════
  //  TEST 12: Auth — Invalid token
  // ════════════════════════════════════════════

  logStep("1️⃣2️⃣", "TEST 12: Auth — Invalid token");

  const badAuth = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Should not work",
  }, "buildersclaw_" + "0".repeat(64));
  assertEqual(badAuth.status, 401, "Invalid token returns 401");

  // ════════════════════════════════════════════
  //  TEST 13: Membership — Non-member can't access
  // ════════════════════════════════════════════

  logStep("1️⃣3️⃣", "TEST 13: Membership — Non-member agent can't access team chat");

  // Gamma is NOT on Alpha's team
  const gammaPost = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "I should not be able to post here",
  }, agentGamma.apiKey);
  assertEqual(gammaPost.status, 403, "Non-member POST returns 403");
  assertIncludes(gammaPost.json.error.message, "not a member", "Error says not a member");

  const gammaGet = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, agentGamma.apiKey);
  assertEqual(gammaGet.status, 403, "Non-member GET returns 403");

  // ════════════════════════════════════════════
  //  TEST 14: Pagination — limit parameter
  // ════════════════════════════════════════════

  logStep("1️⃣4️⃣", "TEST 14: Pagination — limit parameter");

  const limitRes = await api(
    "GET",
    `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=2`,
    null,
    agentAlpha.apiKey,
  );
  assertEqual(limitRes.status, 200, "GET with limit returns 200");
  assert(limitRes.json.messages.length <= 2, `limit=2 returns at most 2 messages (got ${limitRes.json.messages.length})`);

  // ════════════════════════════════════════════
  //  TEST 15: Pagination — before parameter
  // ════════════════════════════════════════════

  logStep("1️⃣5️⃣", "TEST 15: Pagination — before cursor");

  // Get all messages, pick the last one's created_at as cursor
  const allMsgs = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=100`, null, agentAlpha.apiKey);
  if (allMsgs.json.messages.length >= 2) {
    const lastMsg = allMsgs.json.messages[allMsgs.json.messages.length - 1];
    const beforeRes = await api(
      "GET",
      `/hackathons/${hackathonId}/teams/${teamId}/chat?before=${encodeURIComponent(lastMsg.created_at)}&limit=100`,
      null,
      agentAlpha.apiKey,
    );
    assertEqual(beforeRes.status, 200, "GET with before returns 200");
    // All returned messages should be before the cursor
    for (const m of beforeRes.json.messages) {
      assert(
        new Date(m.created_at) < new Date(lastMsg.created_at),
        `Message ${m.id} is before cursor`,
      );
    }
    assert(true, "All messages are before the cursor timestamp");
  } else {
    console.log("  ⏭️  Skipped (not enough messages for before test)");
  }

  // ════════════════════════════════════════════
  //  TEST 16: Default message_type (omit field)
  // ════════════════════════════════════════════

  logStep("1️⃣6️⃣", "TEST 16: Default message_type when omitted");

  const noType = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "No explicit message_type here",
  }, agentAlpha.apiKey);
  assertEqual(noType.status, 201, "POST without message_type succeeds");
  assertEqual(noType.json.message?.message_type, "text", "Defaults to 'text'");

  // ════════════════════════════════════════════
  //  TEST 17: Telegram Webhook — Valid incoming message
  // ════════════════════════════════════════════

  logStep("1️⃣7️⃣", "TEST 17: Telegram Webhook — incoming message simulation");

  // First, we need to set the team's telegram_chat_id so the webhook can route messages
  // We'll simulate this by checking if the webhook processes correctly
  // even without a real Telegram setup, the webhook should return 200 and handle gracefully

  const webhookPayload = {
    update_id: 123456789,
    message: {
      message_id: 100,
      message_thread_id: 99999, // fake thread ID — won't match any team
      from: {
        id: 111222333,
        is_bot: false,
        first_name: "Test",
        last_name: "Human",
        username: "testuser",
      },
      chat: {
        id: -1001234567890,
        type: "supergroup",
      },
      date: Math.floor(Date.now() / 1000),
      text: "Hey team, this is a human from Telegram!",
    },
  };

  const webhookRes = await rawFetch(
    "POST",
    `${BASE_URL}/api/v1/telegram/webhook`,
    webhookPayload,
    { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
  );

  // Webhook should always return 200 (even if message isn't routed to a team)
  assertEqual(webhookRes.status, 200, "Webhook returns 200 for valid secret");
  assert(webhookRes.json.ok === true, "Webhook returns ok: true");

  // ════════════════════════════════════════════
  //  TEST 18: Telegram Webhook — Invalid secret rejected
  // ════════════════════════════════════════════

  logStep("1️⃣8️⃣", "TEST 18: Telegram Webhook — bad secret rejected");

  const badWebhook = await rawFetch(
    "POST",
    `${BASE_URL}/api/v1/telegram/webhook`,
    webhookPayload,
    { "x-telegram-bot-api-secret-token": "wrong_secret" },
  );
  assertEqual(badWebhook.status, 401, "Bad webhook secret returns 401");

  // ════════════════════════════════════════════
  //  TEST 19: Telegram Webhook — No secret header
  // ════════════════════════════════════════════

  logStep("1️⃣9️⃣", "TEST 19: Telegram Webhook — no secret header");

  const noSecretWebhook = await rawFetch(
    "POST",
    `${BASE_URL}/api/v1/telegram/webhook`,
    webhookPayload,
    {},
  );
  assertEqual(noSecretWebhook.status, 401, "Missing webhook secret returns 401");

  // ════════════════════════════════════════════
  //  TEST 20: Telegram Webhook — Bot's own messages ignored
  // ════════════════════════════════════════════

  logStep("2️⃣0️⃣", "TEST 20: Telegram Webhook — bot messages ignored");

  const botWebhookPayload = {
    update_id: 123456790,
    message: {
      message_id: 101,
      message_thread_id: 99999,
      from: {
        id: 999888777,
        is_bot: true,
        first_name: "BuildersClaw",
      },
      chat: {
        id: -1001234567890,
        type: "supergroup",
      },
      date: Math.floor(Date.now() / 1000),
      text: "Bot's own message — should be ignored",
    },
  };

  const botMsgRes = await rawFetch(
    "POST",
    `${BASE_URL}/api/v1/telegram/webhook`,
    botWebhookPayload,
    { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
  );
  assertEqual(botMsgRes.status, 200, "Bot message processed (200) but ignored internally");

  // ════════════════════════════════════════════
  //  TEST 21: Telegram Webhook — Missing text ignored
  // ════════════════════════════════════════════

  logStep("2️⃣1️⃣", "TEST 21: Telegram Webhook — message without text ignored");

  const noTextPayload = {
    update_id: 123456791,
    message: {
      message_id: 102,
      message_thread_id: 99999,
      from: {
        id: 111222333,
        is_bot: false,
        first_name: "Test",
      },
      chat: {
        id: -1001234567890,
        type: "supergroup",
      },
      date: Math.floor(Date.now() / 1000),
      // no text field — e.g. photo or sticker
    },
  };

  const noTextRes = await rawFetch(
    "POST",
    `${BASE_URL}/api/v1/telegram/webhook`,
    noTextPayload,
    { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
  );
  assertEqual(noTextRes.status, 200, "Non-text message returns 200 (silently ignored)");

  // ════════════════════════════════════════════
  //  TEST 22: Telegram Webhook — Invalid JSON
  // ════════════════════════════════════════════

  logStep("2️⃣2️⃣", "TEST 22: Telegram Webhook — invalid JSON body");

  const badJsonWebhook = await fetch(`${BASE_URL}/api/v1/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
    },
    body: "not json at all{{{",
  });
  assertEqual(badJsonWebhook.status, 400, "Invalid JSON webhook returns 400");

  // ════════════════════════════════════════════
  //  TEST 23: Telegram Setup — Admin-only
  // ════════════════════════════════════════════

  logStep("2️⃣3️⃣", "TEST 23: Telegram Setup — admin-only endpoint");

  const setupNoAuth = await api("GET", "/telegram/setup", null, null);
  assertEqual(setupNoAuth.status, 403, "Telegram setup GET without admin returns 403");

  const setupBadAuth = await api("GET", "/telegram/setup", null, agentAlpha.apiKey);
  assertEqual(setupBadAuth.status, 403, "Telegram setup GET with agent key returns 403");

  const setupAdmin = await api("GET", "/telegram/setup", null, ADMIN_API_KEY);
  // This might be 200 (with webhook info) or error if no token configured
  assert(setupAdmin.status === 200 || setupAdmin.status === 500, "Telegram setup GET with admin returns 200 or 500 (depends on token config)");

  // ════════════════════════════════════════════
  //  TEST 24: Chat isolation — Team B can't see Team A messages
  // ════════════════════════════════════════════

  logStep("2️⃣4️⃣", "TEST 24: Chat isolation — different teams don't leak messages");

  // Post a message to Beta's team
  const betaTeamMsg = await api("POST", `/hackathons/${hackathonId}/teams/${teamBetaId}/chat`, {
    content: "This is Beta's team-only message",
  }, agentBeta.apiKey);
  assertEqual(betaTeamMsg.status, 201, "Beta posts to own team");

  // Read Beta's team messages
  const betaTeamGet = await api("GET", `/hackathons/${hackathonId}/teams/${teamBetaId}/chat`, null, agentBeta.apiKey);
  const betaTeamMsgs = betaTeamGet.json.messages.filter((m) => m.sender_type === "agent");
  assert(
    betaTeamMsgs.every((m) => m.team_id === teamBetaId),
    "Beta's team only has Beta's team messages",
  );

  // Ensure Alpha's team doesn't have Beta's team message
  const alphaTeamGet = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, agentAlpha.apiKey);
  const leakedMsg = alphaTeamGet.json.messages.find((m) => m.content === "This is Beta's team-only message");
  assert(leakedMsg === undefined, "Alpha's team does NOT have Beta's team-only message (isolation works)");

  // ════════════════════════════════════════════
  //  TEST 25: Rapid-fire messages (concurrency)
  // ════════════════════════════════════════════

  logStep("2️⃣5️⃣", "TEST 25: Rapid-fire concurrent messages");

  const concurrentCount = 5;
  const promises = [];
  for (let i = 0; i < concurrentCount; i++) {
    const sender = i % 2 === 0 ? agentAlpha : agentBeta;
    promises.push(
      api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
        content: `Concurrent msg #${i} from ${sender.name}`,
        message_type: "text",
      }, sender.apiKey),
    );
  }

  const results = await Promise.all(promises);
  const allSucceeded = results.every((r) => r.status === 201);
  assert(allSucceeded, `All ${concurrentCount} concurrent messages saved (status 201)`);

  // Verify all are readable
  await new Promise((r) => setTimeout(r, 300)); // small settle time
  const afterConcurrent = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat?limit=100`, null, agentAlpha.apiKey);
  for (let i = 0; i < concurrentCount; i++) {
    const found = afterConcurrent.json.messages.find((m) => m.content.includes(`Concurrent msg #${i}`));
    assert(found !== undefined, `Concurrent msg #${i} is readable`);
  }

  // ════════════════════════════════════════════
  //  TEST 26: Message fields are complete
  // ════════════════════════════════════════════

  logStep("2️⃣6️⃣", "TEST 26: Message schema completeness");

  const schemaMsg = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Schema validation message",
    message_type: "text",
  }, agentAlpha.apiKey);

  assertEqual(schemaMsg.status, 201, "Schema message POST succeeds");
  const m = schemaMsg.json.message;
  if (m) {
    const requiredFields = ["id", "team_id", "hackathon_id", "sender_type", "sender_name", "message_type", "content", "created_at"];
    for (const field of requiredFields) {
      assert(m[field] !== undefined && m[field] !== null, `Message has field: ${field}`);
    }
    assertEqual(m.team_id, teamId, "message.team_id matches");
    assertEqual(m.hackathon_id, hackathonId, "message.hackathon_id matches");
  } else {
    assert(false, "Schema message POST returned message object");
  }

  // ════════════════════════════════════════════
  //  TEST 27: Unicode content
  // ════════════════════════════════════════════

  logStep("2️⃣7️⃣", "TEST 27: Unicode and emoji content");

  const unicodeMsg = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "🦞 Hello! Привет! 你好! مرحبا! こんにちは! 🚀✨ Special: <>&\"'",
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(unicodeMsg.status, 201, "Unicode message accepted");
  assertIncludes(unicodeMsg.json.message.content, "🦞", "Emoji preserved in response");
  assertIncludes(unicodeMsg.json.message.content, "Привет", "Cyrillic preserved");
  assertIncludes(unicodeMsg.json.message.content, "你好", "Chinese preserved");

  // ════════════════════════════════════════════
  //  TEST 28: Nonexistent hackathon
  // ════════════════════════════════════════════

  logStep("2️⃣8️⃣", "TEST 28: Nonexistent hackathon / team IDs");

  const fakeTeamPost = await api("POST", `/hackathons/${hackathonId}/teams/00000000-0000-0000-0000-000000000000/chat`, {
    content: "This should fail",
  }, agentAlpha.apiKey);
  assert(fakeTeamPost.status === 403 || fakeTeamPost.status === 404, "Fake team returns 403 or 404");

  const fakeHackathonPost = await api("POST", `/hackathons/00000000-0000-0000-0000-000000000000/teams/${teamId}/chat`, {
    content: "This should fail",
  }, agentAlpha.apiKey);
  assert(fakeHackathonPost.status === 403 || fakeHackathonPost.status === 404, "Fake hackathon returns 403 or 404");

  // ════════════════════════════════════════════
  //  TEST 29: Missing content field entirely
  // ════════════════════════════════════════════

  logStep("2️⃣9️⃣", "TEST 29: Missing content field entirely");

  const noContent = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    message_type: "text",
  }, agentAlpha.apiKey);
  assertEqual(noContent.status, 400, "Missing content field returns 400");

  // ════════════════════════════════════════════
  //  TEST 30: Polling with future timestamp returns empty
  // ════════════════════════════════════════════

  logStep("3️⃣0️⃣", "TEST 30: Polling with future timestamp returns empty");

  const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
  const futureRes = await api(
    "GET",
    `/hackathons/${hackathonId}/teams/${teamId}/chat?since=${encodeURIComponent(futureTime)}`,
    null,
    agentAlpha.apiKey,
  );
  assertEqual(futureRes.status, 200, "Future since returns 200");
  assertEqual(futureRes.json.messages.length, 0, "Future since returns empty array");

  // ════════════════════════════════════════════
  //  RESULTS
  // ════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n  Failed tests:");
    for (const f of failures) {
      console.log(`    ❌ ${f}`);
    }
  }

  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message || err);
  console.error(err.stack);
  process.exit(2);
});
