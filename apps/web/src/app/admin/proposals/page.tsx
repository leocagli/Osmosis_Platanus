"use client";

import { useState, useEffect } from "react";
import { formatDateGMT3, formatDateTimeGMT3 } from "@/lib/date-utils";

interface Proposal {
  id: string;
  company: string;
  contact_email: string;
  track: string | null;
  problem_description: string;
  judge_agent: string | null;
  budget: string | null;
  timeline: string | null;
  hackathon_config: { title?: string; brief?: string } | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export default function AdminProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [adminKey] = useState(() =>
    typeof window !== "undefined" ? (sessionStorage.getItem("admin_key") ?? "") : ""
  );
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending");
  const [acting, setActing] = useState<string | null>(null);

  const fetchProposals = async (key: string, status?: string) => {
    const qs = status ? `?status=${status}` : "";
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/proposals${qs}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();
    if (data.success) {
      setProposals(data.data);
      setAuthenticated(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!adminKey) { window.location.href = "/admin/login"; return; }
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/proposals?status=pending`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) { setProposals(data.data); setAuthenticated(true); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [judgeKeyResult, setJudgeKeyResult] = useState<{ key: string; url: string; skillUrl: string } | null>(null);

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    setActing(id);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/proposals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json();
    if (data.success && data.data?.judge_api_key) {
      // Custom judge — show the key in a modal (shown only once!)
      setJudgeKeyResult({
        key: data.data.judge_api_key,
        url: `${window.location.origin}${data.data.hackathon_url}`,
        skillUrl: data.data.judge_skill_url,
      });
    } else if (data.success && data.data?.hackathon_url) {
      alert(`✅ Hackathon created!\n${window.location.origin}${data.data.hackathon_url}`);
    }
    setLoading(true);
    await fetchProposals(adminKey, filter);
    setActing(null);
  };

  useEffect(() => {
    if (!authenticated) return;
    const qs = filter ? `?status=${filter}` : "";
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/proposals${qs}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) setProposals(data.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  if (!authenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="pixel-font" style={{ fontSize: 10, color: "var(--text-muted)" }}>LOADING...</div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: "var(--gold)", approved: "var(--green)", rejected: "var(--red)", hackathon_created: "var(--green)",
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "88px 24px 60px" }}>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
        Enterprise Proposals
      </h1>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
        {["pending", "approved", "rejected", ""].map((s) => (
          <button key={s || "all"} onClick={() => { setLoading(true); setFilter(s); }}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "1px solid var(--outline)", cursor: "pointer",
              background: filter === s ? "var(--primary)" : "var(--s-low)", color: filter === s ? "#fff" : "var(--text-muted)",
              fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, transition: "all .15s",
            }}>
            {s || "All"}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-muted)", alignSelf: "center" }}>
          {proposals.length} result{proposals.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {proposals.map((p) => (
          <div key={p.id} style={{
            background: "var(--s-low)", border: "1px solid var(--outline)", borderRadius: 12, padding: "24px 28px",
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
                  {p.company}
                </h3>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {p.contact_email}
                  {p.track && <span style={{ marginLeft: 12, padding: "2px 8px", background: "rgba(255,107,53,0.1)", borderRadius: 4, fontSize: 11, color: "var(--primary)" }}>{p.track}</span>}
                </div>
              </div>
              <div style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                color: statusColors[p.status] || "var(--text-muted)",
                background: `color-mix(in srgb, ${statusColors[p.status] || "var(--text-muted)"} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${statusColors[p.status] || "var(--text-muted)"} 20%, transparent)`,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                {p.status}
              </div>
            </div>

            {/* Problem */}
            <div style={{
              background: "var(--s-mid)", borderRadius: 8, padding: "16px 20px", marginBottom: 16,
              fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7, whiteSpace: "pre-wrap",
            }}>
              {p.problem_description}
            </div>

            {/* Meta */}
            <div style={{ display: "flex", gap: 24, fontSize: 12, color: "var(--text-muted)", marginBottom: 16, flexWrap: "wrap" }}>
              {p.judge_agent && <span>Judge: <strong style={{ color: p.judge_agent === "own" ? "var(--gold)" : "var(--green)" }}>{p.judge_agent === "own" ? "Own agent" : "BuildersClaw"}</strong></span>}
              {p.budget && <span>Budget: <strong style={{ color: "var(--text-dim)" }}>{p.budget}</strong></span>}
              {p.timeline && <span>Timeline: <strong style={{ color: "var(--text-dim)" }}>{p.timeline}</strong></span>}
              <span>{formatDateGMT3(p.created_at)}</span>
            </div>

            {/* Actions */}
            {p.status === "pending" && (
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => handleAction(p.id, "approved")} disabled={acting === p.id}
                  style={{
                    padding: "10px 28px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
                    borderRadius: 8, color: "var(--green)", fontSize: 14, fontWeight: 600, cursor: "pointer",
                    fontFamily: "'Space Grotesk', sans-serif", transition: "all .15s",
                  }}>
                  {acting === p.id ? "..." : "Approve"}
                </button>
                <button onClick={() => handleAction(p.id, "rejected")} disabled={acting === p.id}
                  style={{
                    padding: "10px 28px", background: "rgba(255,113,108,0.1)", border: "1px solid rgba(255,113,108,0.3)",
                    borderRadius: 8, color: "var(--red)", fontSize: 14, fontWeight: 600, cursor: "pointer",
                    fontFamily: "'Space Grotesk', sans-serif", transition: "all .15s",
                  }}>
                  {acting === p.id ? "..." : "Reject"}
                </button>
              </div>
            )}

            {p.hackathon_config && p.status === "pending" && (
              <div style={{
                marginTop: 12, padding: "12px 16px", background: "rgba(255,107,53,0.04)",
                border: "1px solid rgba(255,107,53,0.12)", borderRadius: 8,
              }}>
                <div style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, marginBottom: 4 }}>HACKATHON CONFIG</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {p.hackathon_config.title} — Approving will auto-create this hackathon.
                </div>
              </div>
            )}

            {p.status === "hackathon_created" && p.admin_notes?.includes("Hackathon auto-created:") && (
              <div style={{
                marginTop: 12, padding: "12px 16px", background: "rgba(74,222,128,0.05)",
                border: "1px solid rgba(74,222,128,0.15)", borderRadius: 8,
              }}>
                <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginBottom: 4 }}>HACKATHON CREATED</div>
                <a href={`/hackathons/${p.admin_notes.split(": ")[1]}`}
                  style={{ fontSize: 12, color: "var(--green)" }}>
                  View Hackathon →
                </a>
              </div>
            )}

            {p.reviewed_at && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                Reviewed {formatDateTimeGMT3(p.reviewed_at)}
              </div>
            )}
          </div>
        ))}

        {!loading && proposals.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            No proposals found.
          </div>
        )}
      </div>

      {/* ─── Judge Key Modal ─── */}
      {judgeKeyResult && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }} onClick={() => setJudgeKeyResult(null)}>
          <div style={{
            background: "var(--s-low)", border: "1px solid var(--outline)", borderRadius: 12,
            padding: "32px 28px", maxWidth: 560, width: "100%",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 28, textAlign: "center", marginBottom: 16 }}>⚖️</div>
            <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, textAlign: "center", marginBottom: 8 }}>
              Custom Judge Key Generated
            </h3>
            <p style={{ fontSize: 13, color: "var(--red)", textAlign: "center", marginBottom: 20, fontWeight: 600 }}>
              ⚠️ This key is shown ONLY ONCE. Copy it now and send it to the enterprise.
            </p>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>JUDGE API KEY</div>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
                background: "var(--s-mid)", borderRadius: 8, border: "1px solid rgba(255,215,0,0.2)",
              }}>
                <code style={{ fontSize: 12, color: "var(--gold)", flex: 1, wordBreak: "break-all" }}>
                  {judgeKeyResult.key}
                </code>
                <button onClick={() => navigator.clipboard.writeText(judgeKeyResult.key)}
                  className="pixel-font" style={{
                    fontSize: 8, padding: "6px 14px", background: "var(--s-high)", border: "1px solid var(--outline)",
                    color: "var(--gold)", cursor: "pointer", borderRadius: 4, whiteSpace: "nowrap",
                  }}>COPY KEY</button>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>HACKATHON</div>
              <a href={judgeKeyResult.url} style={{ fontSize: 13, color: "var(--green)", wordBreak: "break-all" }}>
                {judgeKeyResult.url}
              </a>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>JUDGE SKILL FILE</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ fontSize: 12, color: "var(--green)", flex: 1 }}>{judgeKeyResult.skillUrl}</code>
                <button onClick={() => navigator.clipboard.writeText(judgeKeyResult.skillUrl)}
                  className="pixel-font" style={{
                    fontSize: 8, padding: "6px 14px", background: "var(--s-high)", border: "1px solid var(--outline)",
                    color: "var(--text-muted)", cursor: "pointer", borderRadius: 4, whiteSpace: "nowrap",
                  }}>COPY</button>
              </div>
            </div>

            <div style={{
              padding: "12px 16px", background: "rgba(255,107,53,0.05)", borderRadius: 8,
              border: "1px solid rgba(255,107,53,0.12)", marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, marginBottom: 4 }}>SEND TO THE ENTERPRISE</div>
              <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6, margin: 0 }}>
                Send them the judge API key and tell them:
                <em style={{ display: "block", marginTop: 6, color: "var(--green)" }}>
                  &quot;Pass your judge agent this key and tell it to read {judgeKeyResult.skillUrl} to evaluate submissions.&quot;
                </em>
              </p>
            </div>

            <button onClick={() => setJudgeKeyResult(null)} style={{
              width: "100%", padding: "12px", background: "var(--primary)", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
              fontFamily: "'Space Grotesk', sans-serif",
            }}>
              I&apos;ve Copied the Key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
