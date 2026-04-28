#!/usr/bin/env node
/**
 * test-create-hackathon.js
 *
 * End-to-end test: Register agent → Create hackathon → Create team → Verify repo + building viz.
 * Usage: node scripts/test-create-hackathon.js [BASE_URL]
 *
 * Default BASE_URL: http://localhost:3000
 */

const BASE_URL = process.argv[2] || "http://localhost:3000";
const API = `${BASE_URL}/api/v1`;

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

function assert(condition, message) {
  if (!condition) {
    console.error(`   ❌ ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log("🦞 Hackaclaw E2E Test — Create Hackathon");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Base URL: ${BASE_URL}`);
  console.log();

  // ── 1. Health check ──
  console.log("1️⃣  Checking API health...");
  const health = await api("GET", "");
  assert(health.status === "operational", `API not healthy: ${JSON.stringify(health)}`);
  console.log("   ✅ API is operational");
  console.log();

  // ── 2. Register a test agent ──
  const agentName = `test_agent_${Date.now()}`;
  console.log(`2️⃣  Registering agent: ${agentName}`);
  const regRes = await api("POST", "/agents/register", {
    name: agentName,
    display_name: "Test Agent",
    personality: "Bold and minimalist. Loves dark themes.",
    strategy: "Fast iteration with clean design",
  });
  assert(regRes.success, `Registration failed: ${JSON.stringify(regRes)}`);
  const apiKey = regRes.data.agent.api_key;
  const agentId = regRes.data.agent.id;
  console.log(`   ✅ Agent registered: ${agentId}`);
  console.log(`   🔑 API Key: ${apiKey.substring(0, 20)}...`);
  console.log();

  // ── 3. Create a hackathon ──
  console.log("3️⃣  Creating hackathon...");
  const hackRes = await api("POST", "/hackathons", {
    title: "E2E Test Hackathon",
    brief: "Build a landing page for a futuristic AI startup called NebulaMind. Include: hero section with animated gradient, pricing table with 3 tiers, testimonials carousel, and a CTA button that pulses.",
    description: "Automated test hackathon",
    challenge_type: "landing_page",
    build_time_seconds: 120,
    max_participants: 50,
    entry_fee: 0,
    ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }, apiKey);
  assert(hackRes.success, `Hackathon creation failed: ${JSON.stringify(hackRes)}`);
  const hackathonId = hackRes.data.id;
  const hackStatus = hackRes.data.status;
  const githubRepo = hackRes.data.github_repo || null;
  console.log(`   ✅ Hackathon created: ${hackathonId}`);
  console.log(`   📊 Status: ${hackStatus}`);
  // Verify team_size_max is 1 (solo mode)
  assert(hackRes.data.team_size_max === 1, `team_size_max should be 1 (solo mode), got: ${hackRes.data.team_size_max}`);
  console.log(`   👤 Team size: ${hackRes.data.team_size_max} (solo mode ✅)`);
  if (githubRepo) {
    console.log(`   📦 GitHub Repo: ${githubRepo}`);
  } else {
    console.log("   ⚠️  No GitHub repo (GITHUB_TOKEN may not be set or creation failed)");
  }
  console.log();

  // ── 4. Verify hackathon in list ──
  console.log("4️⃣  Verifying hackathon appears in list...");
  const listRes = await api("GET", "/hackathons?status=open");
  assert(listRes.success, "Failed to list hackathons");
  const found = listRes.data.some((h) => h.id === hackathonId);
  assert(found, "Hackathon not found in open list");
  console.log("   ✅ Hackathon found in open list");
  console.log();

  // ── 5. Create a team (solo) ──
  console.log("5️⃣  Creating team (solo mode)...");
  const teamRes = await api("POST", `/hackathons/${hackathonId}/teams`, {
    name: "Test Solo Team",
    color: "#ff6b35",
  }, apiKey);
  assert(teamRes.success, `Team creation failed: ${JSON.stringify(teamRes)}`);
  const teamId = teamRes.data.team.id;
  console.log(`   ✅ Team created: ${teamId}`);
  console.log();

  // ── 6. Verify building visualization ──
  console.log("6️⃣  Checking building visualization...");
  const buildingRes = await api("GET", `/hackathons/${hackathonId}/building`);
  assert(buildingRes.success, "Failed to get building data");
  const floors = buildingRes.data.floors;
  assert(floors.length === 1, `Expected 1 floor, got ${floors.length}`);
  assert(floors[0].lobsters.length === 1, `Expected 1 lobster, got ${floors[0].lobsters.length}`);
  console.log(`   ✅ Building: ${floors.length} floor, ${floors[0].lobsters.length} lobster`);
  console.log(`   🦞 Lobster: ${floors[0].lobsters[0].agent_name} (${floors[0].lobsters[0].role})`);
  console.log(`   🪑 Empty seats: ${floors[0].empty_seats}`);
  console.log();

  // ── 7. Verify agent status ──
  console.log("7️⃣  Checking agent status...");
  const meRes = await api("GET", "/agents/me", null, apiKey);
  assert(meRes.success, "Failed to get agent status");
  const hackathons = meRes.data.hackathons;
  assert(hackathons.length === 1, `Expected 1 hackathon, got ${hackathons.length}`);
  assert(hackathons[0].my_role === "leader", `Expected role 'leader', got '${hackathons[0].my_role}'`);
  console.log(`   ✅ Agent is in ${hackathons.length} hackathon as ${hackathons[0].my_role}`);
  console.log();

  // ── 8. Verify marketplace returns 501 ──
  console.log("8️⃣  Verifying marketplace is disabled (v2)...");
  const marketRes = await api("GET", "/marketplace");
  assert(!marketRes.success, "Marketplace should return error");
  assert(marketRes.error.message.includes("v2"), `Expected 'v2' in message, got: ${marketRes.error.message}`);
  console.log("   ✅ Marketplace correctly returns 'Coming in v2' message");
  console.log();

  // ── 9. Verify join-team returns 501 ──
  console.log("9️⃣  Verifying team-join is disabled (v2)...");
  const joinRes = await api("POST", `/hackathons/${hackathonId}/teams/${teamId}/join`, {}, apiKey);
  assert(!joinRes.success, "Join should return error");
  assert(joinRes.error.message.includes("v2"), `Expected 'v2' in message, got: ${joinRes.error.message}`);
  console.log("   ✅ Team-join correctly returns 'Coming in v2' message");
  console.log();

  // ── 10. Verify GitHub repo was created ──
  if (githubRepo) {
    console.log("🔟  Verifying GitHub repo...");
    try {
      const repoUrl = githubRepo.replace("https://github.com/", "https://api.github.com/repos/");
      const repoCheck = await fetch(repoUrl);
      if (repoCheck.ok) {
        const repoData = await repoCheck.json();
        console.log(`   ✅ GitHub repo exists: ${repoData.full_name}`);
        console.log(`   📝 Description: ${repoData.description}`);
        console.log(`   🌐 URL: ${repoData.html_url}`);
      } else {
        console.log(`   ⚠️  GitHub repo check returned ${repoCheck.status} (may need auth)`);
      }
    } catch (err) {
      console.log(`   ⚠️  Could not verify GitHub repo: ${err.message}`);
    }
    console.log();
  }

  // ── Summary ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ ALL TESTS PASSED");
  console.log();
  console.log("Summary:");
  console.log(`  Agent:     ${agentName} (${agentId})`);
  console.log(`  Hackathon: E2E Test Hackathon (${hackathonId})`);
  console.log(`  Team:      Test Solo Team (${teamId})`);
  if (githubRepo) console.log(`  GitHub:    ${githubRepo}`);
  console.log();
  console.log("🦞 Done!");
}

main().catch((err) => {
  console.error(`\n❌ FATAL: ${err.message}`);
  process.exit(1);
});
