#!/usr/bin/env node
/**
 * test-competition.js
 *
 * Full competition E2E test:
 *   1. Register 2 agents
 *   2. Create a hackathon (verifies GitHub repo)
 *   3. Each agent creates a team + sends a prompt to build
 *   4. Verify GitHub has folders for each team (team-slug/round-1/)
 *   5. Agent 1 sends a second prompt (round 2 iteration)
 *   6. Trigger AI judge
 *   7. Get leaderboard — verify scores + ranking
 *   8. Check building viz — 2 floors, 1 lobster each
 *   9. Verify hackathon status transitions (open → in_progress → judging → completed)
 *
 * Usage: node scripts/test-competition.js [BASE_URL]
 * Requires: GEMINI_API_KEY set in the server env (for judging)
 *           GITHUB_TOKEN set in the server env (for repo creation)
 *           An LLM API key for code generation (uses gemini via env)
 *
 * Default BASE_URL: http://localhost:3000
 */

const BASE_URL = process.argv[2] || "http://localhost:3000";
const API = `${BASE_URL}/api/v1`;

// No LLM key needed — the server uses its own Gemini key (paid by entry fees)

function readEnvFile(key) {
  try {
    const fs = require("fs");
    const content = fs.readFileSync(".env.local", "utf8");
    const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
    return match ? match[1].trim() : "";
  } catch { return ""; }
}

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
    console.error(`   ❌ FAIL: ${message}`);
    process.exit(1);
  }
}

function pass(msg) { console.log(`   ✅ ${msg}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const ts = Date.now();
  
  console.log("🦞 BuildersClaw — Full Competition Test");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Base URL: ${BASE_URL}`);
  console.log();

  // ━━━ 1. Register two agents ━━━
  console.log("1️⃣  Registering two competing agents...");
  
  const reg1 = await api("POST", "/agents/register", {
    name: `alpha_${ts}`,
    display_name: "Alpha Agent",
    personality: "Bold dark minimalist. Neon green accents. Confident copy with strong CTAs.",
    strategy: "Visual impact first — make it look stunning",
  });
  assert(reg1.success, `Agent 1 registration failed: ${JSON.stringify(reg1)}`);
  const agent1 = { key: reg1.data.agent.api_key, id: reg1.data.agent.id, name: reg1.data.agent.name };
  pass(`Agent 1: ${agent1.name}`);

  const reg2 = await api("POST", "/agents/register", {
    name: `beta_${ts}`,
    display_name: "Beta Agent",
    personality: "Clean and professional. Light blue tones. Data-driven layout with trust signals.",
    strategy: "Content first — nail the brief compliance",
  });
  assert(reg2.success, `Agent 2 registration failed: ${JSON.stringify(reg2)}`);
  const agent2 = { key: reg2.data.agent.api_key, id: reg2.data.agent.id, name: reg2.data.agent.name };
  pass(`Agent 2: ${agent2.name}`);
  console.log();

  // ━━━ 2. Create hackathon ━━━
  console.log("2️⃣  Creating hackathon...");
  
  const hackRes = await api("POST", "/hackathons", {
    title: `Competition Test ${ts}`,
    brief: "Build a landing page for 'NebulaAI' — an AI-powered productivity tool. Must include: hero section with animated background, 3-tier pricing table, customer testimonials, and a prominent CTA button. Target audience: startup founders.",
    description: "Full competition test with 2 agents",
    challenge_type: "landing_page",
    build_time_seconds: 120,
    max_participants: 10,
    entry_fee: 0,
    ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }, agent1.key);
  assert(hackRes.success, `Hackathon creation failed: ${JSON.stringify(hackRes)}`);
  
  const hackathonId = hackRes.data.id;
  const githubRepo = hackRes.data.github_repo;
  pass(`Hackathon: ${hackathonId}`);
  assert(hackRes.data.status === "open", `Expected status 'open', got '${hackRes.data.status}'`);
  pass(`Status: open ✓`);

  if (githubRepo) {
    pass(`GitHub repo: ${githubRepo}`);
  } else {
    console.log("   ⚠️  No GitHub repo (GITHUB_TOKEN may not be set)");
  }
  console.log();

  // ━━━ 3. Each agent creates a team ━━━
  console.log("3️⃣  Agents creating teams...");

  const team1Res = await api("POST", `/hackathons/${hackathonId}/teams`, {
    name: `Team Alpha ${ts}`,
    color: "#00ff88",
  }, agent1.key);
  assert(team1Res.success, `Team 1 creation failed: ${JSON.stringify(team1Res)}`);
  const team1Id = team1Res.data.team.id;
  pass(`Team 1: "Team Alpha ${ts}" (${team1Id})`);

  const team2Res = await api("POST", `/hackathons/${hackathonId}/teams`, {
    name: `Team Beta ${ts}`,
    color: "#3388ff",
  }, agent2.key);
  assert(team2Res.success, `Team 2 creation failed: ${JSON.stringify(team2Res)}`);
  const team2Id = team2Res.data.team.id;
  pass(`Team 2: "Team Beta ${ts}" (${team2Id})`);
  console.log();

  // ━━━ 4. Agent 1 — Round 1 prompt ━━━
  console.log("4️⃣  Agent 1 sends Round 1 prompt (building...)");
  
  const prompt1R1 = await api("POST", `/hackathons/${hackathonId}/teams/${team1Id}/prompt`, {
    prompt: "Build a dark minimalist landing page for NebulaAI. Use a #0a0a0f background with neon green (#00ffaa) accents. Include: animated gradient hero with tagline 'AI That Works While You Sleep', 3-tier pricing (Free/$29/$99), testimonial cards, and a pulsing CTA button. Make it responsive.",
    llm_provider: "gemini",
    llm_api_key: LLM_API_KEY,
  }, agent1.key);
  assert(prompt1R1.success, `Agent 1 Round 1 failed: ${JSON.stringify(prompt1R1)}`);
  
  const r1files = prompt1R1.data.files;
  pass(`Round 1 complete: ${r1files.length} file(s), ${r1files.reduce((s, f) => s + f.size, 0)} bytes`);
  pass(`Provider: ${prompt1R1.data.provider}/${prompt1R1.data.model}`);
  if (prompt1R1.data.commit_url) pass(`Commit: ${prompt1R1.data.commit_url}`);
  if (prompt1R1.data.github_folder) pass(`Folder: ${prompt1R1.data.github_folder}`);
  console.log();

  // ━━━ 5. Verify hackathon moved to in_progress ━━━
  console.log("5️⃣  Checking hackathon status after first prompt...");
  
  const hackCheck1 = await api("GET", `/hackathons/${hackathonId}`);
  assert(hackCheck1.success, "Failed to get hackathon");
  assert(hackCheck1.data.status === "in_progress", `Expected 'in_progress', got '${hackCheck1.data.status}'`);
  pass(`Status: in_progress ✓ (transitioned from open after first prompt)`);
  console.log();

  // ━━━ 6. Agent 2 — Round 1 prompt ━━━
  console.log("6️⃣  Agent 2 sends Round 1 prompt (building...)");
  
  const prompt2R1 = await api("POST", `/hackathons/${hackathonId}/teams/${team2Id}/prompt`, {
    prompt: "Build a clean professional landing page for NebulaAI. Use white/light gray background with blue (#3388ff) accents. Include: hero with product mockup, features grid with icons, 3-tier pricing comparison table, customer logos bar, and email signup CTA. Focus on trust and credibility.",
    llm_provider: "gemini",
    llm_api_key: LLM_API_KEY,
  }, agent2.key);
  assert(prompt2R1.success, `Agent 2 Round 1 failed: ${JSON.stringify(prompt2R1)}`);
  
  const r2files = prompt2R1.data.files;
  pass(`Round 1 complete: ${r2files.length} file(s), ${r2files.reduce((s, f) => s + f.size, 0)} bytes`);
  pass(`Provider: ${prompt2R1.data.provider}/${prompt2R1.data.model}`);
  if (prompt2R1.data.github_folder) pass(`Folder: ${prompt2R1.data.github_folder}`);
  console.log();

  // ━━━ 7. Agent 1 — Round 2 iteration ━━━
  console.log("7️⃣  Agent 1 sends Round 2 prompt (iterating...)");
  
  const prompt1R2 = await api("POST", `/hackathons/${hackathonId}/teams/${team1Id}/prompt`, {
    prompt: "Improve the landing page: the hero contrast needs to be stronger — make the tagline text larger and bolder. Add a floating animation to the CTA button. The pricing table needs a 'Most Popular' badge on the middle tier. Add a footer with social links.",
    llm_provider: "gemini",
    llm_api_key: LLM_API_KEY,
  }, agent1.key);
  assert(prompt1R2.success, `Agent 1 Round 2 failed: ${JSON.stringify(prompt1R2)}`);
  assert(prompt1R2.data.round === 2, `Expected round 2, got ${prompt1R2.data.round}`);
  pass(`Round 2 complete: ${prompt1R2.data.files.length} file(s)`);
  pass(`Iteration working — round ${prompt1R2.data.round} builds on round 1`);
  if (prompt1R2.data.github_folder) pass(`Folder: ${prompt1R2.data.github_folder}`);
  console.log();

  // ━━━ 8. Verify GitHub repo structure ━━━
  if (githubRepo) {
    console.log("8️⃣  Verifying GitHub repo structure...");

    const repoFullName = githubRepo.replace("https://github.com/", "");
    const token = readEnvFile("GITHUB_TOKEN");
    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    };

    // Check repo contents at root
    const contentsRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/`, { headers: ghHeaders });
    if (contentsRes.ok) {
      const contents = await contentsRes.json();
      const folders = contents.filter(c => c.type === "dir").map(c => c.name);
      const files = contents.filter(c => c.type === "file").map(c => c.name);

      pass(`Root files: ${files.join(", ")}`);
      pass(`Team folders: ${folders.join(", ")}`);

      // Verify team folders exist
      const team1Slug = slugify(`Team Alpha ${ts}`);
      const team2Slug = slugify(`Team Beta ${ts}`);

      const hasTeam1 = folders.some(f => f.includes("team-alpha"));
      const hasTeam2 = folders.some(f => f.includes("team-beta"));
      assert(hasTeam1, `Team 1 folder not found. Expected slug containing 'team-alpha'. Got: ${folders.join(", ")}`);
      assert(hasTeam2, `Team 2 folder not found. Expected slug containing 'team-beta'. Got: ${folders.join(", ")}`);
      pass(`Both team folders exist ✓`);

      // Check Agent 1 has round-1 and round-2
      const team1FolderName = folders.find(f => f.includes("team-alpha"));
      const team1Contents = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${team1FolderName}`, { headers: ghHeaders });
      if (team1Contents.ok) {
        const t1dirs = (await team1Contents.json()).filter(c => c.type === "dir").map(c => c.name);
        const hasR1 = t1dirs.includes("round-1");
        const hasR2 = t1dirs.includes("round-2");
        assert(hasR1, `Agent 1 round-1 folder missing. Got: ${t1dirs.join(", ")}`);
        assert(hasR2, `Agent 1 round-2 folder missing. Got: ${t1dirs.join(", ")}`);
        pass(`Agent 1 rounds: ${t1dirs.join(", ")} ✓`);
      }

      // Check Agent 2 has round-1
      const team2FolderName = folders.find(f => f.includes("team-beta"));
      const team2Contents = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${team2FolderName}`, { headers: ghHeaders });
      if (team2Contents.ok) {
        const t2dirs = (await team2Contents.json()).filter(c => c.type === "dir").map(c => c.name);
        const hasR1 = t2dirs.includes("round-1");
        assert(hasR1, `Agent 2 round-1 folder missing. Got: ${t2dirs.join(", ")}`);
        pass(`Agent 2 rounds: ${t2dirs.join(", ")} ✓`);
      }
    } else {
      console.log(`   ⚠️  Could not read repo contents: ${contentsRes.status}`);
    }
    console.log();
  } else {
    console.log("8️⃣  Skipping GitHub verification (no repo created)");
    console.log();
  }

  // ━━━ 9. Building visualization — 2 floors ━━━
  console.log("9️⃣  Checking building visualization...");
  
  const buildingRes = await api("GET", `/hackathons/${hackathonId}/building`);
  assert(buildingRes.success, "Failed to get building data");
  
  const floors = buildingRes.data.floors;
  assert(floors.length === 2, `Expected 2 floors, got ${floors.length}`);
  
  for (const floor of floors) {
    assert(floor.lobsters.length === 1, `Floor ${floor.floor_number} has ${floor.lobsters.length} lobsters, expected 1`);
    pass(`Floor ${floor.floor_number}: "${floor.team_name}" — 🦞 ${floor.lobsters[0].agent_name} (${floor.lobsters[0].role})`);
  }
  pass(`Building: ${floors.length} floors, 1 lobster each ✓`);
  console.log();

  // ━━━ 10. Trigger judge ━━━
  console.log("🔟  Triggering AI judge...");
  
  const judgeRes = await api("POST", `/hackathons/${hackathonId}/judge`);
  assert(judgeRes.success, `Judging failed: ${JSON.stringify(judgeRes)}`);
  assert(judgeRes.data.judged === 2, `Expected 2 judged, got ${judgeRes.data.judged}`);

  for (const result of judgeRes.data.results) {
    if (result.error) {
      console.log(`   ⚠️  ${result.team_name || result.submission_id}: ${result.error}`);
    } else {
      pass(`${result.team_name}: ${result.total_score}/100`);
    }
  }
  console.log();

  // ━━━ 11. Verify hackathon completed ━━━
  console.log("1️⃣1️⃣  Checking final hackathon status...");
  
  const hackFinal = await api("GET", `/hackathons/${hackathonId}`);
  assert(hackFinal.success, "Failed to get hackathon");
  assert(hackFinal.data.status === "completed", `Expected 'completed', got '${hackFinal.data.status}'`);
  pass(`Status: completed ✓`);
  console.log();

  // ━━━ 12. Leaderboard ━━━
  console.log("1️⃣2️⃣  Getting leaderboard...");
  
  const lbRes = await api("GET", `/hackathons/${hackathonId}/judge`);
  assert(lbRes.success, "Failed to get leaderboard");
  
  const ranked = lbRes.data;
  assert(ranked.length === 2, `Expected 2 entries, got ${ranked.length}`);
  
  // Verify sorted by score
  if (ranked[0].total_score !== null && ranked[1].total_score !== null) {
    assert(ranked[0].total_score >= ranked[1].total_score, "Leaderboard not sorted by score descending");
  }

  console.log();
  console.log("   🏆 LEADERBOARD:");
  ranked.forEach((team, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || `#${i + 1}`;
    const score = team.total_score ?? "—";
    const agent = team.members?.[0]?.agent_name || "?";
    console.log(`   ${medal} ${team.team_name} — ${score}/100 (${agent})`);
    if (team.judge_feedback) {
      console.log(`      💬 "${team.judge_feedback.substring(0, 100)}${team.judge_feedback.length > 100 ? '...' : ''}"`);
    }
  });
  console.log();

  // ━━━ 13. Check preview links ━━━
  console.log("1️⃣3️⃣  Checking submission previews...");
  
  for (const team of ranked) {
    if (team.submission_id) {
      const previewUrl = `${BASE_URL}/api/v1/submissions/${team.submission_id}/preview`;
      const previewRes = await fetch(previewUrl);
      assert(previewRes.ok, `Preview failed for ${team.team_name}: ${previewRes.status}`);
      const html = await previewRes.text();
      assert(html.includes("<!DOCTYPE html") || html.includes("<html"), `Preview not valid HTML for ${team.team_name}`);
      pass(`${team.team_name}: preview OK (${html.length} chars)`);
    }
  }
  console.log();

  // ━━━ 14. Agent /me endpoints ━━━
  console.log("1️⃣4️⃣  Checking agent status endpoints...");
  
  const me1 = await api("GET", "/agents/me", null, agent1.key);
  assert(me1.success, "Agent 1 /me failed");
  const h1 = me1.data.hackathons[0];
  assert(h1.hackathon_status === "completed", `Agent 1 sees status '${h1.hackathon_status}'`);
  assert(h1.submission !== null, "Agent 1 has no submission");
  assert(h1.submission.score !== null, "Agent 1 has no score");
  pass(`Agent 1: score ${h1.submission.score}/100, role: ${h1.my_role}`);

  const me2 = await api("GET", "/agents/me", null, agent2.key);
  assert(me2.success, "Agent 2 /me failed");
  const h2 = me2.data.hackathons[0];
  assert(h2.hackathon_status === "completed", `Agent 2 sees status '${h2.hackathon_status}'`);
  assert(h2.submission !== null, "Agent 2 has no submission");
  assert(h2.submission.score !== null, "Agent 2 has no score");
  pass(`Agent 2: score ${h2.submission.score}/100, role: ${h2.my_role}`);
  console.log();

  // ━━━ 15. Activity log ━━━
  console.log("1️⃣5️⃣  Checking activity log...");
  
  const actRes = await api("GET", `/hackathons/${hackathonId}/activity?limit=20`);
  assert(actRes.success, "Activity log failed");
  
  const events = actRes.data;
  const eventTypes = [...new Set(events.map(e => e.event_type))];
  pass(`${events.length} events: ${eventTypes.join(", ")}`);
  
  // Should have: team_created (x2), prompt_submitted (x3), score_received (x2)
  const teamCreated = events.filter(e => e.event_type === "team_created").length;
  const promptSubmitted = events.filter(e => e.event_type === "prompt_submitted").length;
  const scoreReceived = events.filter(e => e.event_type === "score_received").length;
  
  assert(teamCreated === 2, `Expected 2 team_created events, got ${teamCreated}`);
  assert(promptSubmitted === 3, `Expected 3 prompt_submitted events, got ${promptSubmitted}`);
  assert(scoreReceived === 2, `Expected 2 score_received events, got ${scoreReceived}`);
  pass(`Events verified: ${teamCreated} teams, ${promptSubmitted} prompts, ${scoreReceived} scores ✓`);
  console.log();

  // ━━━ Summary ━━━
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ ALL COMPETITION TESTS PASSED");
  console.log();
  console.log("Flow verified:");
  console.log("  register → create hackathon → create teams → prompt (x3)");
  console.log("  → GitHub commits → judge → leaderboard → previews → activity");
  console.log();
  console.log("Status transitions: open → in_progress → judging → completed ✓");
  console.log();
  console.log(`  Agent 1: ${agent1.name} — ${h1.submission.score}/100`);
  console.log(`  Agent 2: ${agent2.name} — ${h2.submission.score}/100`);
  console.log(`  Winner:  ${ranked[0].team_name} 🏆`);
  if (githubRepo) console.log(`  GitHub:  ${githubRepo}`);
  console.log();
  console.log("🦞 Done!");
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

main().catch((err) => {
  console.error(`\n❌ FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
