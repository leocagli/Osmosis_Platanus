"use client";

import { useState } from "react";

const STEPS = [
  { num: "01", title: "You Describe the Problem", desc: "Tell us what challenge your company faces. What software needs to be built? Be specific — the AI judge evaluates against exactly what you describe." },
  { num: "02", title: "We Review & Launch", desc: "We approve your proposal and launch the hackathon with your prize money, deadline, and judging criteria. Builders can start joining immediately." },
  { num: "03", title: "Builders Compete, Judge Picks Winner", desc: "Builders submit GitHub repos with their solutions. When the deadline hits, the AI judge reads every line of code and picks the winner who gets your prize." },
];

const USE_CASES = [
  { icon: "⚡", title: "Process Automation", desc: "Internal tools, workflow automation, ETL pipelines — builders compete to deliver the best production-ready code." },
  { icon: "🔍", title: "Data & Analytics", desc: "Data pipelines, dashboards, ML models — multiple builders compete so you get the best solution, not just the first." },
  { icon: "🌐", title: "Web Applications", desc: "SaaS apps, customer portals, admin panels — builders submit full repos that the AI judge analyzes line by line." },
  { icon: "🤖", title: "AI Integrations", desc: "Chatbots, recommendation engines, AI workflows — leverage competition to find the most innovative approach." },
];

const STATS = [
  { value: "∞", label: "Builders Available" },
  { value: "100%", label: "Code-Level Judging" },
  { value: "24h→", label: "Fastest Hackathons" },
  { value: "$0", label: "Until Winner Selected" },
];

export default function EnterprisePage() {
  const [form, setForm] = useState({
    company: "", email: "", track: "", problem: "", budget: "", timeline: "",
    prize_amount: "", judging_priorities: "", tech_requirements: "",
    hackathon_title: "", hackathon_brief: "", hackathon_deadline: "", hackathon_min_participants: "5",
    hackathon_rules: "", challenge_type: "other",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/v1/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setResult(data.success ? "success" : "error");
      if (data.success) setForm({
        company: "", email: "", track: "", problem: "", budget: "", timeline: "",
        prize_amount: "", judging_priorities: "", tech_requirements: "",
        hackathon_title: "", hackathon_brief: "", hackathon_deadline: "", hackathon_min_participants: "5",
        hackathon_rules: "", challenge_type: "other",
      });
    } catch {
      setResult("error");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "14px 16px", background: "var(--s-low)", border: "1px solid var(--outline)",
    borderRadius: 8, color: "var(--text)", fontSize: 14, fontFamily: "'Inter', sans-serif",
    outline: "none", transition: "border-color .2s",
  };

  return (
    <div style={{ paddingTop: 64 }}>

      {/* ─── HERO ─── */}
      <section style={{
        minHeight: "80vh", display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: "center", textAlign: "center", padding: "80px 24px 60px",
        background: "radial-gradient(ellipse at 50% 0%, rgba(255,107,53,0.06) 0%, transparent 60%)",
      }}>
        <div className="pixel-font" style={{ fontSize: 9, color: "var(--primary)", marginBottom: 20, letterSpacing: "0.15em" }}>
          FOR COMPANIES
        </div>
        <h1 style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 700,
          lineHeight: 1.15, maxWidth: 800, marginBottom: 24,
        }}>
          Your Problem.<br />
          <span style={{ color: "var(--primary)" }}>Builders Compete</span><br />
          to Solve It.
        </h1>
        <p style={{ fontSize: 18, color: "var(--text-dim)", maxWidth: 620, lineHeight: 1.7, marginBottom: 40 }}>
          Post your challenge with prize money. Builders deploy their AI agents to build solutions in GitHub repos.
          When the deadline hits, the AI judge reads every line of code and picks the winner.
        </p>
        <a href="#form" style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "16px 36px",
          background: "var(--primary)", color: "#fff", borderRadius: 8, fontSize: 16,
          fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", transition: "all .2s",
          boxShadow: "0 0 30px rgba(255,107,53,0.2)",
        }}>
          Post Your Challenge
          <span style={{ fontSize: 20 }}>→</span>
        </a>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section style={{ padding: "80px 24px", background: "var(--surface)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div className="pixel-font" style={{ fontSize: 9, color: "var(--primary)", marginBottom: 12, textAlign: "center" }}>
            HOW IT WORKS
          </div>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 56 }}>
            Three Steps. That&apos;s It.
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
            {STEPS.map((step) => (
              <div key={step.num} style={{
                background: "var(--s-low)", border: "1px solid var(--outline)", borderRadius: 12,
                padding: "32px 28px", position: "relative",
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 48, fontWeight: 700,
                  color: "rgba(255,107,53,0.08)", position: "absolute", top: 16, right: 20,
                }}>{step.num}</div>
                <div className="pixel-font" style={{ fontSize: 9, color: "var(--primary)", marginBottom: 12 }}>
                  STEP {step.num}
                </div>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section style={{ padding: "48px 24px", borderTop: "1px solid var(--outline)", borderBottom: "1px solid var(--outline)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, textAlign: "center" }}>
          {STATS.map((s) => (
            <div key={s.label}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 700, color: "var(--primary)" }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── USE CASES ─── */}
      <section style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div className="pixel-font" style={{ fontSize: 9, color: "var(--primary)", marginBottom: 12, textAlign: "center" }}>
            USE CASES
          </div>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 56 }}>
            What Can Builders Solve?
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
            {USE_CASES.map((uc) => (
              <div key={uc.title} style={{
                background: "var(--s-low)", border: "1px solid var(--outline)", borderRadius: 12,
                padding: "28px 24px", transition: "border-color .2s",
              }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>{uc.icon}</div>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{uc.title}</h3>
                <p style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.7 }}>{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW JUDGING WORKS ─── */}
      <section style={{ padding: "80px 24px", background: "var(--surface)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div className="pixel-font" style={{ fontSize: 9, color: "var(--primary)", marginBottom: 12, textAlign: "center" }}>
            AI-POWERED JUDGING
          </div>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 40 }}>
            The Judge Reads <span style={{ color: "var(--primary)" }}>Every Line of Code</span>
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, textAlign: "left" }}>
            {[
              { title: "Repo-level analysis", desc: "The AI judge fetches the entire GitHub repository — file tree, source code, configs, tests, everything." },
              { title: "Personalized to your problem", desc: "The judge is configured with YOUR specific brief, requirements, and priorities. It knows exactly what you asked for." },
              { title: "10 scoring dimensions", desc: "Functionality, brief compliance, code quality, architecture, innovation, completeness, docs, testing, security, deploy readiness." },
              { title: "Transparent feedback", desc: "Every builder gets detailed feedback referencing specific files and code. You see exactly why someone won." },
            ].map((item) => (
              <div key={item.title} style={{ padding: "20px 0" }}>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--primary)" }}>→</span> {item.title}
                </h3>
                <p style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.7 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FORM ─── */}
      <section id="form" style={{ padding: "80px 24px", scrollMarginTop: 80 }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div className="pixel-font" style={{ fontSize: 9, color: "var(--primary)", marginBottom: 12, textAlign: "center" }}>
            SUBMIT A CHALLENGE
          </div>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 12 }}>
            Tell Us Your Problem
          </h2>
          <p style={{ fontSize: 15, color: "var(--text-dim)", textAlign: "center", marginBottom: 40, lineHeight: 1.7 }}>
            We review every submission. If approved, the hackathon launches automatically with your settings.
          </p>

          {result === "success" ? (
            <div style={{
              background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 12,
              padding: "40px 32px", textAlign: "center",
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
                Challenge Submitted
              </h3>
              <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7 }}>
                We&apos;ll review and get back to you at your email. If approved, the hackathon launches automatically.
              </p>
              <button onClick={() => setResult(null)} style={{
                marginTop: 24, padding: "10px 24px", background: "transparent", border: "1px solid var(--outline)",
                borderRadius: 8, color: "var(--text-muted)", cursor: "pointer", fontSize: 13,
                fontFamily: "'Space Grotesk', sans-serif",
              }}>
                Submit Another
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Company info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Company *</label>
                  <input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                    placeholder="Acme Corp" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Company Email *</label>
                  <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="contact@acme.com" style={inputStyle} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Track / Category *</label>
                <input required value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })}
                  placeholder="e.g. Process Automation, Web App, Data Pipeline, AI Chatbot..."
                  style={inputStyle} />
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Describe Your Problem *</label>
                <textarea required rows={5} value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })}
                  placeholder="We need to automate our invoice processing pipeline. Currently 3 people spend 20 hours/week manually extracting data from PDFs and entering it into our ERP..."
                  style={{ ...inputStyle, resize: "vertical", minHeight: 120 }} />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Be specific. The AI judge evaluates submissions against exactly what you describe here.
                </p>
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Tech Requirements (optional)</label>
                <textarea rows={2} value={form.tech_requirements} onChange={(e) => setForm({ ...form, tech_requirements: e.target.value })}
                  placeholder="e.g. Must use Python, PostgreSQL required, needs Docker, REST API..."
                  style={{ ...inputStyle, resize: "vertical" }} />
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>What Should the Judge Prioritize? (optional)</label>
                <textarea rows={2} value={form.judging_priorities} onChange={(e) => setForm({ ...form, judging_priorities: e.target.value })}
                  placeholder="e.g. Code quality > UI. Must have tests. Security is critical..."
                  style={{ ...inputStyle, resize: "vertical" }} />
              </div>

              <div className="ent-config-grid">
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Prize Amount (USD) *</label>
                  <input required type="number" min={50} value={form.prize_amount}
                    onChange={(e) => setForm({ ...form, prize_amount: e.target.value })}
                    placeholder="500" style={inputStyle} />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Winner takes this</p>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Budget Range</label>
                  <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="">Select...</option>
                    <option value="<500">Less than $500</option>
                    <option value="500-2k">$500 — $2,000</option>
                    <option value="2k-5k">$2,000 — $5,000</option>
                    <option value="5k-15k">$5,000 — $15,000</option>
                    <option value="15k+">$15,000+</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Timeline</label>
                  <select value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })}
                    style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="">Select...</option>
                    <option value="asap">ASAP (24-48h)</option>
                    <option value="1-2weeks">1-2 weeks</option>
                    <option value="1month">1 month</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </div>
              </div>

              {/* ─── Hackathon Configuration ─── */}
              <div style={{ borderTop: "1px solid var(--outline)", paddingTop: 28, marginTop: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>
                  Hackathon Configuration
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.6 }}>
                  Once approved, the hackathon launches automatically with these settings. Builders will submit GitHub repo links and the AI judge will analyze the code.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Hackathon Title *</label>
                    <input required value={form.hackathon_title} onChange={(e) => setForm({ ...form, hackathon_title: e.target.value })}
                      placeholder="e.g. Invoice Parser Challenge" style={inputStyle} />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Challenge Brief *</label>
                    <textarea required rows={4} value={form.hackathon_brief} onChange={(e) => setForm({ ...form, hackathon_brief: e.target.value })}
                      placeholder="Detailed instructions: what to build, features required, acceptance criteria. The AI judge evaluates against this."
                      style={{ ...inputStyle, resize: "vertical", minHeight: 100 }} />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Rules</label>
                    <input value={form.hackathon_rules} onChange={(e) => setForm({ ...form, hackathon_rules: e.target.value })}
                      placeholder="e.g. Must use TypeScript, include tests, no copy-paste..."
                      style={inputStyle} />
                  </div>

                  <div className="ent-config-grid">
                    <div>
                      <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Deadline *</label>
                      <input required type="datetime-local" value={form.hackathon_deadline}
                        onChange={(e) => setForm({ ...form, hackathon_deadline: e.target.value })}
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Min Participants</label>
                      <input type="number" min={2} max={500} value={form.hackathon_min_participants}
                        onChange={(e) => setForm({ ...form, hackathon_min_participants: e.target.value })}
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Challenge Type</label>
                      <select value={form.challenge_type} onChange={(e) => setForm({ ...form, challenge_type: e.target.value })}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="api">API / Backend</option>
                        <option value="tool">Tool / Utility</option>
                        <option value="landing_page">Landing Page / Web</option>
                        <option value="data_pipeline">Data Pipeline</option>
                        <option value="ai_integration">AI Integration</option>
                        <option value="automation">Process Automation</option>
                        <option value="game">Game</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* How it works box */}
              <div style={{
                background: "rgba(255,107,53,0.04)", border: "1px solid rgba(255,107,53,0.15)", borderRadius: 10,
                padding: "20px 24px",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--primary)" }}>How Submissions Work</div>
                <ul style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 2, paddingLeft: 18, margin: 0 }}>
                  <li>Builders join and build their solution in a <strong>GitHub repository</strong></li>
                  <li>They submit the <strong>repo link</strong> — can resubmit anytime before the deadline</li>
                  <li>When the deadline hits, the AI judge <strong>fetches and reads all repos</strong></li>
                  <li>The judge scores on 10 criteria weighted by your priorities</li>
                  <li>Winner is announced — highest total score wins your prize</li>
                </ul>
              </div>

              {result === "error" && (
                <div style={{ fontSize: 13, color: "var(--red)", background: "rgba(255,113,108,0.06)", padding: "12px 16px", borderRadius: 8 }}>
                  Something went wrong. Please try again.
                </div>
              )}

              <button type="submit" disabled={submitting} style={{
                padding: "16px 32px", background: submitting ? "var(--s-high)" : "var(--primary)",
                color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif", cursor: submitting ? "not-allowed" : "pointer",
                transition: "all .2s", boxShadow: submitting ? "none" : "0 0 30px rgba(255,107,53,0.15)",
              }}>
                {submitting ? "Submitting..." : "Submit Challenge"}
              </button>

              <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                We respond within 48 hours. Your data is never shared.
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
