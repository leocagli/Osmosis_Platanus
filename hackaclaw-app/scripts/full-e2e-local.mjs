/**
 * FULL E2E from scratch: 
 * 1. Enterprise submits proposal (gets judge key)
 * 2. Admin logs in and approves
 * 3. Hackathon is created
 * 4. Builders join and submit repos
 * 5. Deadline passes (2 min)
 * 6. Cron triggers judging
 * 7. Winner announced
 */

const BASE = "http://localhost:3456";
const ADMIN_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_KEY) { console.error("Missing ADMIN_API_KEY env var"); process.exit(1); }
const ts = Date.now();

async function api(method, path, body, key) {
  const h = { "Content-Type": "application/json" };
  if (key) h["Authorization"] = `Bearer ${key}`;
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

function log(step, msg) { console.log(`\n${"═".repeat(50)}\n${step}  ${msg}\n${"═".repeat(50)}`); }
function ok(label, val) { console.log(`  ✅ ${label}${val ? ` — ${val}` : ""}`); }
function fail(label, val) { console.log(`  ❌ ${label}${val ? ` — ${val}` : ""}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("🦞 FULL E2E TEST — BuildersClaw — From Scratch\n");

  // ═══ STEP 1: Enterprise submits challenge with custom judge ═══
  log("STEP 1", "Enterprise submits challenge");

  // Deadline = 2 minutes from now
  const deadline = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const proposal = await api("POST", "/api/v1/proposals", {
    company: `TestCorp ${ts}`,
    email: "test@testcorp.com",
    track: "API / Backend",
    problem: "We need an AI invoice parser that extracts structured data from PDFs.",
    judge_agent: "own",
    budget: "500-2k",
    timeline: "asap",
    prize_amount: "500",
    judging_priorities: "Brief compliance > code quality. Must have tests.",
    tech_requirements: "TypeScript, REST API",
    hackathon_title: `Invoice Parser Challenge ${ts}`,
    hackathon_brief: "Build a REST API that takes PDF invoices and returns structured JSON with vendor, amount, date, and line items.",
    hackathon_rules: "TypeScript. Must include tests. Public GitHub repo.",
    hackathon_deadline: deadline,
    hackathon_min_participants: "2",
    challenge_type: "api",
  });

  if (proposal.success) {
    ok("Proposal submitted", proposal.data.id);
    ok("Judge API key", `${proposal.data.judge_api_key?.slice(0, 20)}...`);
    ok("Judge skill URL", proposal.data.judge_skill_url);
  } else {
    fail("Proposal failed", JSON.stringify(proposal));
    return;
  }

  const proposalId = proposal.data.id;
  const judgeKey = proposal.data.judge_api_key;

  // ═══ STEP 2: Admin logs in and sees proposal ═══
  log("STEP 2", "Admin reviews proposals");

  const proposals = await api("GET", "/api/v1/proposals?status=pending", null, ADMIN_KEY);
  if (proposals.success) {
    const found = proposals.data.find(p => p.id === proposalId);
    ok("Admin sees proposal", `${found?.company} — ${found?.judge_agent === "own" ? "Custom Judge" : "Platform Judge"}`);
  } else {
    fail("Admin can't see proposals", JSON.stringify(proposals));
    return;
  }

  // ═══ STEP 3: Admin approves → hackathon auto-created ═══
  log("STEP 3", "Admin approves → Hackathon created");

  const approval = await api("PATCH", "/api/v1/proposals", {
    id: proposalId,
    status: "approved",
    notes: "Looks good, approved!",
  }, ADMIN_KEY);

  if (approval.success && approval.data.hackathon_id) {
    ok("Hackathon created", approval.data.hackathon_id);
    ok("Hackathon URL", approval.data.hackathon_url);
  } else {
    fail("Approval failed", JSON.stringify(approval));
    return;
  }

  const hackathonId = approval.data.hackathon_id;

  // Verify hackathon exists and is open
  const hackathon = await api("GET", `/api/v1/hackathons/${hackathonId}`);
  ok("Status", hackathon.data?.status);
  ok("Title", hackathon.data?.title);
  ok("Prize pool", `$${hackathon.data?.prize_pool}`);
  ok("Deadline", hackathon.data?.ends_at);

  // ═══ STEP 4: Builders register, join, submit repos ═══
  log("STEP 4", "Builders join and submit repos");

  const b1 = await api("POST", "/api/v1/agents/register", { name: `e2e_b1_${ts}`, display_name: "Builder Alpha 🔷", model: "gemini" });
  const k1 = b1.data.agent.api_key;
  const j1 = await api("POST", `/api/v1/hackathons/${hackathonId}/join`, { name: "Invoice Parser Pro", color: "#00c2a8" }, k1);
  ok("Builder 1 joined", `team=${j1.data?.team?.id}`);
  const t1 = j1.data.team.id;

  const b2 = await api("POST", "/api/v1/agents/register", { name: `e2e_b2_${ts}`, display_name: "Builder Beta 🔶", model: "openai" });
  const k2 = b2.data.agent.api_key;
  const j2 = await api("POST", `/api/v1/hackathons/${hackathonId}/join`, { name: "PDF Wizard", color: "#ff8a00" }, k2);
  ok("Builder 2 joined", `team=${j2.data?.team?.id}`);
  const t2 = j2.data.team.id;

  // Submit repos
  const s1 = await api("POST", `/api/v1/hackathons/${hackathonId}/teams/${t1}/submit`, {
    repo_url: "https://github.com/MartinPuli/hackaclaw-test-invoice-parser",
    notes: "Full TypeScript implementation with tests and Dockerfile.",
  }, k1);
  ok("Builder 1 submitted", s1.data?.submission_id);

  const s2 = await api("POST", `/api/v1/hackathons/${hackathonId}/teams/${t2}/submit`, {
    repo_url: "https://github.com/MartinPuli/hackaclaw-test-invoice-parser",
    notes: "Complete implementation.",
  }, k2);
  ok("Builder 2 submitted", s2.data?.submission_id);

  // Check leaderboard shows repos
  const lb = await api("GET", `/api/v1/hackathons/${hackathonId}/judge`);
  for (const t of lb.data || []) {
    ok(`${t.team_name} repo visible`, t.repo_url?.slice(0, 50));
  }

  // ═══ STEP 5: Wait for deadline ═══
  log("STEP 5", "Waiting for 2-minute deadline...");
  
  const deadlineMs = new Date(deadline).getTime();
  const waitMs = Math.max(0, deadlineMs - Date.now()) + 5000; // +5s buffer
  info(`Deadline: ${deadline}`);
  info(`Waiting ${Math.round(waitMs / 1000)}s...`);
  
  // Show countdown
  const startWait = Date.now();
  while (Date.now() < deadlineMs + 3000) {
    const remaining = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
    process.stdout.write(`\r  ⏳ ${remaining}s remaining...   `);
    await sleep(5000);
  }
  console.log("\r  ⏰ Deadline passed!          ");

  // ═══ STEP 6: Trigger cron (judging) ═══
  log("STEP 6", "Cron triggers AI judging");
  
  const cron = await api("GET", "/api/v1/cron/judge");
  if (cron.success) {
    ok("Cron processed", `${cron.details?.length || 0} hackathons`);
    for (const d of cron.details || []) {
      ok(`  ${d.title || d.id}`, d.success ? "Judged ✓" : `Failed: ${d.error}`);
    }
  } else {
    // If cron didn't pick it up (maybe custom judge), trigger manually
    info("Cron didn't process — this is a custom-judge hackathon");
    info("The enterprise's judge agent should submit scores via POST /judge/submit");
    
    // Let's test the custom judge flow
    log("STEP 6b", "Custom judge agent fetches submissions");
    
    const judgeData = await api("GET", `/api/v1/hackathons/${hackathonId}/judge/submit`, null, judgeKey);
    if (judgeData.success) {
      ok("Judge sees submissions", `${judgeData.data.submissions?.length} submissions`);
      ok("Brief available", judgeData.data.brief?.slice(0, 50) + "...");
      ok("Enterprise problem", judgeData.data.enterprise_problem?.slice(0, 50) + "...");
      
      // Submit scores
      const scores = judgeData.data.submissions.map((s, i) => ({
        team_id: s.team_id,
        functionality_score: 85 - i * 10,
        brief_compliance_score: 90 - i * 15,
        code_quality_score: 80 - i * 5,
        architecture_score: 75 - i * 10,
        innovation_score: 70 - i * 5,
        completeness_score: 85 - i * 10,
        documentation_score: 65 - i * 10,
        testing_score: 55 - i * 15,
        security_score: 70 - i * 5,
        deploy_readiness_score: 60 - i * 10,
        judge_feedback: i === 0 
          ? "Excellent implementation. Clean TypeScript code with proper separation of concerns. Tests cover core functionality."
          : "Solid attempt but missing some edge cases. Tests are minimal. Could improve error handling.",
      }));

      const judgeSubmit = await api("POST", `/api/v1/hackathons/${hackathonId}/judge/submit`, { scores }, judgeKey);
      if (judgeSubmit.success) {
        ok("Custom judge scored all submissions", `Winner: ${judgeSubmit.data.winner_team_id?.slice(0, 12)}`);
      } else {
        fail("Custom judge submit failed", JSON.stringify(judgeSubmit));
      }
    } else {
      fail("Judge can't see submissions", JSON.stringify(judgeData));
    }
  }

  // ═══ STEP 7: Final state ═══
  log("STEP 7", "Final hackathon state");

  const final = await api("GET", `/api/v1/hackathons/${hackathonId}`);
  const status = final.data?.status;
  status === "finalized" ? ok("Status", "FINALIZED ✓") : fail("Status", status);
  
  if (final.data?.winner) {
    ok("Winner", `Agent: ${final.data.winner.agent_id?.slice(0, 12)}... Team: ${final.data.winner.team_id?.slice(0, 12)}...`);
    ok("Prize", `$${final.data.prize_pool}`);
  }

  const finalLb = await api("GET", `/api/v1/hackathons/${hackathonId}/judge`);
  if (finalLb.data) {
    console.log("\n  🏆 FINAL LEADERBOARD:");
    for (const t of finalLb.data) {
      console.log(`    ${t.winner ? '👑' : '  '} ${t.team_name}: ${t.total_score}/100 — ${t.repo_url?.split('/').pop()}`);
    }
  }

  log("DONE", `View: ${BASE}/hackathons/${hackathonId}`);
}

main().catch(console.error);
