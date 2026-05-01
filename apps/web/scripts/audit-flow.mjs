/**
 * Full flow audit — tests every step of the hackathon lifecycle.
 */
const BASE = "https://www.buildersclaw.xyz";
const ts = Date.now();
const repo1 = `https://github.com/${process.env.GITHUB_OWNER || "buildersclaw"}/audit-flow-${ts}-alpha`;
const repo2 = `https://github.com/${process.env.GITHUB_OWNER || "buildersclaw"}/audit-flow-${ts}-beta`;

async function api(method, path, body, key) {
  const h = { "Content-Type": "application/json" };
  if (key) h["Authorization"] = `Bearer ${key}`;
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

function check(label, condition, detail) {
  const icon = condition ? "✅" : "❌";
  console.log(`${icon} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   FULL FLOW AUDIT — BuildersClaw     ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ═══ STEP 1: Enterprise submits proposal with custom judge ═══
  console.log("── STEP 1: Enterprise submits proposal ──");
  const proposal = await api("POST", "/api/v1/proposals", {
    company: `AuditCorp ${ts}`,
    email: "audit@test.com",
    track: "API / Backend",
    problem: "We need an invoice parser that extracts structured JSON from PDFs.",
    judge_agent: "own",
    budget: "500-2k",
    timeline: "1-2weeks",
    prize_amount: "500",
    judging_priorities: "Brief compliance > code quality. Must have tests.",
    tech_requirements: "TypeScript, REST API",
    hackathon_title: `Audit Hackathon ${ts}`,
    hackathon_brief: "Build a PDF invoice parser with REST API.",
    hackathon_rules: "TypeScript only. Must include tests.",
    hackathon_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    hackathon_min_participants: "2",
    challenge_type: "api",
  });

  check("Proposal submitted", proposal.success, proposal.data?.id);
  check("Judge API key returned", !!proposal.data?.judge_api_key, `judge_${proposal.data?.judge_api_key?.slice(6,12)}...`);
  check("Judge skill URL returned", !!proposal.data?.judge_skill_url);
  const judgeKey = proposal.data?.judge_api_key;

  // ═══ STEP 2: Verify proposal is pending ═══
  console.log("\n── STEP 2: Hackathon does NOT exist yet (pending) ──");
  const hackathons = await api("GET", "/api/v1/hackathons?status=open");
  const auditHackathon = hackathons.data?.find(h => h.title?.includes(`Audit Hackathon ${ts}`));
  check("Hackathon NOT created yet", !auditHackathon, "Correct — waiting for admin approval");

  // ═══ STEP 3: Simulate admin approval ═══
  console.log("\n── STEP 3: Admin approves proposal ──");
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    console.log("⚠️  ADMIN_API_KEY not set — skipping approval test");
    console.log("   Set ADMIN_API_KEY env var to test full flow\n");
    
    // Still test what we can
    console.log("── REMAINING STEPS (testing with existing hackathon) ──");
    
    // Use a creator to make a hackathon directly
    const c = await api("POST", "/api/v1/agents/register", { name: `audit_creator_${ts}`, display_name: "Audit Creator", model: "gemini" });
    const cKey = c.data.agent.api_key;
    
    const h = await api("POST", "/api/v1/hackathons", {
      title: `Audit Flow ${ts}`, brief: "Build a PDF invoice parser.", rules: "TypeScript.",
      entry_fee: 0, prize_pool: 500, max_participants: 10, challenge_type: "api",
      ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }, cKey);
    check("Hackathon created (direct)", h.success, h.data?.id);
    const hId = h.data.id;

    // ═══ STEP 4: Agents join ═══
    console.log("\n── STEP 4: Builders join ──");
    const a1 = await api("POST", "/api/v1/agents/register", { name: `audit_b1_${ts}`, display_name: "Builder 1 🔷", model: "gemini" });
    const k1 = a1.data.agent.api_key;
    const j1 = await api("POST", `/api/v1/hackathons/${hId}/join`, { name: "Team Alpha", color: "#00c2a8" }, k1);
    check("Builder 1 joined", j1.success, `team=${j1.data?.team?.id}`);
    const t1 = j1.data?.team?.id;

    const a2 = await api("POST", "/api/v1/agents/register", { name: `audit_b2_${ts}`, display_name: "Builder 2 🔶", model: "openai" });
    const k2 = a2.data.agent.api_key;
    const j2 = await api("POST", `/api/v1/hackathons/${hId}/join`, { name: "Team Beta", color: "#ff8a00" }, k2);
    check("Builder 2 joined", j2.success, `team=${j2.data?.team?.id}`);
    const t2 = j2.data?.team?.id;

    // ═══ STEP 5: Submit repos ═══
    console.log("\n── STEP 5: Builders submit repos ──");
    const s1 = await api("POST", `/api/v1/hackathons/${hId}/teams/${t1}/submit`, {
      repo_url: repo1,
      notes: "Full TypeScript implementation.",
    }, k1);
    check("Builder 1 submitted", s1.success, s1.data?.submission_id);

    const s2 = await api("POST", `/api/v1/hackathons/${hId}/teams/${t2}/submit`, {
      repo_url: repo2,
      notes: "Separate repo for beta team.",
    }, k2);
    check("Builder 2 submitted", s2.success, s2.data?.submission_id);

    // ═══ STEP 5b: Re-submit ═══
    console.log("\n── STEP 5b: Re-submit before deadline ──");
    const re = await api("POST", `/api/v1/hackathons/${hId}/teams/${t1}/submit`, {
      repo_url: repo1,
      notes: "Updated — added more tests.",
    }, k1);
    check("Re-submit works", re.success && re.data?.updated === true, "updated=true");

    // ═══ STEP 6: Building view shows repos ═══
    console.log("\n── STEP 6: Building view shows repos ──");
    const lb = await api("GET", `/api/v1/hackathons/${hId}/judge`);
    check("Leaderboard loads", lb.success, `${lb.data?.length} teams`);
    if (lb.data) {
      for (const t of lb.data) {
        check(`  ${t.team_name} has repo`, !!t.repo_url, t.repo_url?.slice(0, 60));
      }
    }

    // ═══ STEP 7: Trigger judging ═══
    console.log("\n── STEP 7: AI Judge reads repos and scores ──");
    const judge = await api("POST", `/api/v1/admin/hackathons/${hId}/judge`, {}, cKey);
    check("Judging queued", judge.success, `run=${judge.data?.judging_run_id?.slice(0, 8)} status=${judge.data?.status}`);

    // ═══ STEP 8: Final state ═══
    console.log("\n── STEP 8: Final hackathon state ──");
    const final = await api("GET", `/api/v1/hackathons/${hId}`);
    check("Status is finalized", final.data?.status === "finalized", final.data?.status);
    check("Has winner", !!final.data?.winner, final.data?.winner?.agent_id?.slice(0, 12));

    console.log(`\n🔗 View: ${BASE}/hackathons/${hId}`);
  }

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║          AUDIT COMPLETE              ║");
  console.log("╚══════════════════════════════════════╝");
}

main().catch(console.error);
