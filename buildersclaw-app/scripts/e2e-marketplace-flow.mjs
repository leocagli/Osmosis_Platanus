#!/usr/bin/env node

/**
 * E2E Test — Marketplace Flow (step-by-step, isolated)
 *
 * This script creates its own agents + hackathon so it can be run repeatedly
 * without depending on previous state.
 *
 * Default scope:
 *   1. Register leader, claimant, outsider
 *   2. Seed a free hackathon
 *   3. Leader joins hackathon
 *   4. Leader posts a marketplace listing
 *   5. Marketplace browse API returns the listing
 *   6. Claimant takes the listing
 *   7. Team/chat/submission flow works for hired member
 *   8. Outsider is rejected from team chat
 *
 * Optional ERC-8004 scope (only if test env vars are provided):
 *   9. Link leader to an ERC-8004 identity
 *  10. Sync identity/reputation
 *  11. Re-fetch marketplace and assert identity metadata is surfaced
 *
 * Usage:
 *   node scripts/e2e-marketplace-flow.mjs
 *
 * Required env:
 *   BASE_URL
 *   TEST_CREDIT_SECRET (or ADMIN_API_KEY fallback for seed endpoint)
 *
 * Optional ERC-8004 env:
 *   TEST_ERC8004_AGENT_ID
 *   TEST_ERC8004_OWNER_PRIVATE_KEY
 *   TEST_ERC8004_SOURCE   (optional, default: external)
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { privateKeyToAccount } from "viem/accounts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

loadEnvFile(path.join(appRoot, ".env.local"));
loadEnvFile(path.join(appRoot, ".env"), { override: true });

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://localhost:3000");
const TEST_CREDIT_SECRET = process.env.TEST_CREDIT_SECRET || process.env.ADMIN_API_KEY;

const OPTIONAL_ERC8004_AGENT_ID = process.env.TEST_ERC8004_AGENT_ID || "";
const OPTIONAL_ERC8004_OWNER_PRIVATE_KEY = process.env.TEST_ERC8004_OWNER_PRIVATE_KEY || "";
const OPTIONAL_ERC8004_SOURCE = process.env.TEST_ERC8004_SOURCE || "external";

let passed = 0;
let failed = 0;
const failures = [];

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

function normalizeBaseUrl(value) {
  return value.replace("://localhost:", "://127.0.0.1:");
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function fakeWallet(label) {
  return `0x${crypto.createHash("sha256").update(`${label}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 40)}`;
}

function fakeTelegram(label) {
  return `${label}_${Date.now().toString().slice(-6)}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
}

function step(label, message) {
  console.log(`\n${label} ${message}`);
}

function assert(condition, label, detail) {
  if (condition) {
    passed += 1;
    console.log(`  OK  ${label}`);
    return;
  }
  failed += 1;
  const line = `  FAIL ${label}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  failures.push(line);
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(value, needle, label) {
  assert(typeof value === "string" && value.includes(needle), label, `expected to include ${needle}, got ${value}`);
}

async function api(method, apiPath, body, apiKey, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${BASE_URL}/api/v1${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { success: false, raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

async function seedHackathon(overrides = {}) {
  const payload = {
    title: uid("Marketplace Flow"),
    brief: "Test marketplace role claims and collaboration flow.",
    challenge_type: "tool",
    prize_pool: 250,
    team_size_max: 3,
    ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };

  const response = await fetch(`${BASE_URL}/api/v1/seed-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seed-secret": TEST_CREDIT_SECRET || "",
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (json.success) {
    return { id: json.data.id, seededVia: "api" };
  }

  if (json?.error?.message !== "TEST_CREDIT_SECRET not configured") {
    throw new Error(`Failed to seed hackathon: ${JSON.stringify(json)}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "TEST_CREDIT_SECRET is not configured on the server, and Supabase service role envs are unavailable for fallback seeding",
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = crypto.randomUUID();
  const now = new Date();
  const insert = await supabaseAdmin.from("hackathons").insert({
    id,
    title: payload.title,
    description: payload.description || "Marketplace flow seeded hackathon",
    brief: payload.brief,
    rules: payload.rules || null,
    entry_type: "free",
    entry_fee: 0,
    prize_pool: payload.prize_pool,
    platform_fee_pct: 0.1,
    max_participants: 500,
    team_size_min: 1,
    team_size_max: payload.team_size_max,
    build_time_seconds: 180,
    challenge_type: payload.challenge_type,
    status: "open",
    created_by: null,
    starts_at: now.toISOString(),
    ends_at: payload.ends_at,
  });
  if (insert.error) {
    throw new Error(`Fallback Supabase seed failed: ${JSON.stringify(insert.error)}`);
  }

  return { id, seededVia: "supabase" };
}

async function registerAgent(prefix, options = {}) {
  const payload = {
    name: uid(prefix),
    model: options.model || "gpt-4o",
    description: options.description || `${prefix} marketplace test agent`,
    stack: options.stack || "node.js",
    wallet_address: options.wallet_address,
    github_username: options.github_username,
    telegram_username: options.telegram_username,
  };

  const reg = await api("POST", "/agents/register", payload);
  if (!reg.ok) {
    if (reg.status !== 429) {
      throw new Error(`Register ${prefix} failed: ${JSON.stringify(reg.json)}`);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(`Register ${prefix} hit rate limit and Supabase fallback is unavailable`);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const id = crypto.randomUUID();
    const apiKey = `buildersclaw_${crypto.randomBytes(32).toString("hex")}`;
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const strategy = JSON.stringify({
      stack: payload.stack,
      github_username: payload.github_username,
      telegram_username: payload.telegram_username,
    });

    const insert = await supabaseAdmin.from("agents").insert({
      id,
      name: payload.name,
      display_name: payload.name,
      description: payload.description,
      wallet_address: payload.wallet_address,
      api_key_hash: apiKeyHash,
      model: payload.model,
      personality: null,
      strategy,
    });

    if (insert.error) {
      throw new Error(`Register ${prefix} fallback insert failed: ${JSON.stringify(insert.error)}`);
    }

    return {
      id,
      name: payload.name,
      key: apiKey,
      wallet_address: options.wallet_address || null,
      telegram_username: options.telegram_username || null,
      github_username: options.github_username || null,
    };
  }

  return {
    id: reg.json.data.agent.id,
    name: reg.json.data.agent.name,
    key: reg.json.data.agent.api_key,
    wallet_address: options.wallet_address || null,
    telegram_username: options.telegram_username || null,
    github_username: options.github_username || null,
  };
}

async function maybeLinkErc8004(agent) {
  if (!OPTIONAL_ERC8004_AGENT_ID || !OPTIONAL_ERC8004_OWNER_PRIVATE_KEY) {
    return { attempted: false };
  }

  const issuedAt = new Date().toISOString();
  const identityInfo = await api(
    "GET",
    `/agents/identity?identity_agent_id=${encodeURIComponent(OPTIONAL_ERC8004_AGENT_ID)}&issued_at=${encodeURIComponent(issuedAt)}`,
    null,
    agent.key,
  );

  if (!identityInfo.ok || !identityInfo.json?.data?.link_message) {
    return {
      attempted: true,
      linked: false,
      reason: `identity GET failed: ${JSON.stringify(identityInfo.json)}`,
    };
  }

  const account = privateKeyToAccount(normalizePrivateKey(OPTIONAL_ERC8004_OWNER_PRIVATE_KEY));
  const signature = await account.signMessage({ message: identityInfo.json.data.link_message });

  const link = await api("POST", "/agents/identity", {
    action: "link",
    identity_agent_id: OPTIONAL_ERC8004_AGENT_ID,
    issued_at: issuedAt,
    signature,
    identity_source: OPTIONAL_ERC8004_SOURCE,
  }, agent.key);

  if (!link.ok) {
    return {
      attempted: true,
      linked: false,
      reason: `identity link failed: ${JSON.stringify(link.json)}`,
    };
  }

  const sync = await api("POST", "/agents/identity", { action: "sync" }, agent.key);
  return {
    attempted: true,
    linked: sync.ok,
    link,
    sync,
    reason: sync.ok ? null : `identity sync failed: ${JSON.stringify(sync.json)}`,
  };
}

async function main() {
  if (TEST_CREDIT_SECRET) {
    process.env.TEST_CREDIT_SECRET = TEST_CREDIT_SECRET;
  }

  console.log("============================================================");
  console.log(" BuildersClaw Marketplace Flow E2E");
  console.log("============================================================");
  console.log(` Base URL: ${BASE_URL}`);
  console.log(` Time:     ${new Date().toISOString()}`);

  step("1.", "Warm up server");
  const warm = await api("GET", "/marketplace?status=open");
  assert(warm.status < 500, "Marketplace route responds without server crash", `status=${warm.status}`);

  step("2.", "Register isolated agents with wallet/github/telegram prereqs");
  const leader = await registerAgent("market_leader", {
    wallet_address: fakeWallet("leader"),
    github_username: uid("ghleader"),
    telegram_username: fakeTelegram("leader"),
  });
  const claimant = await registerAgent("market_claimant", {
    wallet_address: fakeWallet("claimant"),
    github_username: uid("ghclaimant"),
    telegram_username: fakeTelegram("claimant"),
  });
  const outsider = await registerAgent("market_outsider", {
    wallet_address: fakeWallet("outsider"),
    github_username: uid("ghoutsider"),
    telegram_username: fakeTelegram("outsider"),
  });
  assert(!!leader.key && !!claimant.key && !!outsider.key, "All agents registered successfully");

  step("3.", "Seed a free test hackathon");
  const seeded = await seedHackathon();
  const hackathonId = seeded.id;
  assert(typeof hackathonId === "string", "Seed endpoint returns a hackathon id");
  console.log(`  Seeded via: ${seeded.seededVia}`);

  step("4.", "Leader joins the hackathon and creates a team");
  const join = await api("POST", `/hackathons/${hackathonId}/join`, { name: uid("Market Team") }, leader.key);
  assert(join.ok, "Leader join succeeds", JSON.stringify(join.json));
  const teamId = join.json?.data?.team?.id;
  assert(typeof teamId === "string", "Leader join returns team id");

  step("5.", "Leader posts a marketplace listing");
  const listingCreate = await api("POST", "/marketplace", {
    hackathon_id: hackathonId,
    team_id: teamId,
    role_title: "API Engineer",
    role_type: "builder",
    role_description: "Implement the API endpoints and auth integration.",
    repo_url: "https://github.com/buildersclaw/marketplace-flow-test",
    share_pct: 30,
  }, leader.key);
  assertEqual(listingCreate.status, 201, "Listing is created");
  const listingId = listingCreate.json?.data?.id;
  assert(typeof listingId === "string", "Listing id is returned");
  assertEqual(listingCreate.json?.data?.share_pct, 30, "Listing share is 30%");

  step("6.", "Marketplace browse returns the open listing");
  const browseOpen = await api("GET", `/marketplace?hackathon_id=${hackathonId}&status=open`);
  assert(browseOpen.ok, "Browse open marketplace succeeds", JSON.stringify(browseOpen.json));
  const openListing = Array.isArray(browseOpen.json?.data)
    ? browseOpen.json.data.find((listing) => listing.id === listingId)
    : null;
  assert(!!openListing, "Created listing appears in GET /marketplace");
  assertEqual(openListing?.team_id, teamId, "Listing team id matches");
  assertEqual(openListing?.poster_name, leader.name, "Listing poster name is surfaced");
  assertEqual(openListing?.status, "open", "Listing status is open before claim");

  step("7.", "Claimant takes the marketplace listing");
  const take = await api("POST", `/marketplace/${listingId}/take`, {}, claimant.key);
  assert(take.ok, "Claimant takes listing successfully", JSON.stringify(take.json));
  assertEqual(take.json?.data?.share_pct, 30, "Claim response preserves listing share");
  assertIncludes(take.json?.data?.message || "", "claimed", "Claim response confirms success");

  step("8.", "Listing moves to taken state and outsider cannot steal it");
  const browseTaken = await api("GET", `/marketplace?hackathon_id=${hackathonId}&status=taken`);
  const takenListing = Array.isArray(browseTaken.json?.data)
    ? browseTaken.json.data.find((listing) => listing.id === listingId)
    : null;
  assert(!!takenListing, "Taken listing appears in taken marketplace feed");
  assertEqual(takenListing?.taken_by, claimant.id, "taken_by matches claimant agent");
  const outsiderTake = await api("POST", `/marketplace/${listingId}/take`, {}, outsider.key);
  assertEqual(outsiderTake.status, 409, "Outsider cannot claim an already taken listing");

  step("9.", "Team membership, chat, and submission work for hired member");
  const teams = await api("GET", `/hackathons/${hackathonId}/teams`);
  assert(teams.ok, "Teams endpoint succeeds", JSON.stringify(teams.json));
  const ourTeam = Array.isArray(teams.json?.data)
    ? teams.json.data.find((team) => team.id === teamId)
    : null;
  const teamMembers = Array.isArray(ourTeam?.members) ? ourTeam.members : [];
  const claimantMember = teamMembers.find((member) => member.agent_id === claimant.id);
  assert(teamMembers.length >= 2, "Team has at least leader + claimant");
  assertEqual(claimantMember?.joined_via, "marketplace", "Claimant joined_via is marketplace");

  const leaderChat = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/chat`, {
    content: "Welcome to the team. Start with the auth middleware.",
    message_type: "text",
  }, leader.key);
  assertEqual(leaderChat.status, 201, "Leader can post to team chat");

  const claimantChatRead = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, claimant.key);
  assertEqual(claimantChatRead.status, 200, "Claimant can read team chat");
  assert(Array.isArray(claimantChatRead.json?.messages) && claimantChatRead.json.messages.length >= 1, "Claimant sees chat messages");

  const outsiderChatRead = await api("GET", `/hackathons/${hackathonId}/teams/${teamId}/chat`, null, outsider.key);
  assertEqual(outsiderChatRead.status, 403, "Outsider cannot read team chat");

  const submit = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    repo_url: "https://github.com/buildersclaw/marketplace-flow-test",
    notes: "Marketplace flow test submission",
  }, claimant.key);
  assert(submit.ok, "Hired member can submit for the team", JSON.stringify(submit.json));

  step("10.", "Optional ERC-8004 identity linking and marketplace surfacing");
  const identity = await maybeLinkErc8004(leader);
  if (!identity.attempted) {
    console.log("  SKIP ERC-8004 optional test (set TEST_ERC8004_AGENT_ID + TEST_ERC8004_OWNER_PRIVATE_KEY to enable)");
  } else if (!identity.linked) {
    assert(false, "ERC-8004 link/sync succeeds", identity.reason);
  } else {
    assert(true, "ERC-8004 link/sync succeeds");
    const browseIdentity = await api("GET", `/marketplace?hackathon_id=${hackathonId}&status=taken`);
    const listingWithIdentity = Array.isArray(browseIdentity.json?.data)
      ? browseIdentity.json.data.find((listing) => listing.id === listingId)
      : null;
    assert(!!listingWithIdentity?.poster_identity, "Marketplace listing includes poster_identity");
    assertEqual(listingWithIdentity?.poster_identity?.linked, true, "poster_identity.linked is true");
    assert(!!listingWithIdentity?.poster_identity?.agent_registry, "poster_identity.agent_registry is present");
    assert(listingWithIdentity?.poster_external_reputation !== undefined, "Marketplace listing includes poster_external_reputation");
  }

  console.log("\n============================================================");
  console.log(` Passed: ${passed}`);
  console.log(` Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(" Failures:");
    for (const failure of failures) console.log(failure);
  }
  console.log("============================================================");

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nFATAL:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
