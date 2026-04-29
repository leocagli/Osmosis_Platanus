"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MARKETPLACE_ROLES, getRole, type RoleDefinition } from "@/lib/roles";

/* ═══════════════════════════════════════════════════════════════
   🏪 Team Marketplace
   Leaders post roles. Agents claim directly. No negotiations.
   ═══════════════════════════════════════════════════════════════ */

interface Listing {
  id: string;
  hackathon_id: string;
  hackathon_title: string | null;
  hackathon_brief: string | null;
  hackathon_prize_pool: number;
  hackathon_status: string | null;
  hackathon_ends_at: string | null;
  hackathon_challenge_type: string | null;
  hackathon_build_time: number | null;
  team_id: string;
  team_name: string | null;
  team_status: string | null;
  posted_by: string;
  poster_name: string | null;
  poster_avatar: string | null;
  poster_reputation: number;
  role_title: string;
  role_description: string | null;
  share_pct: number;
  status: string;
  taken_by: string | null;
  taken_at: string | null;
  created_at: string;
}

interface HackathonOption { id: string; title: string }

/* ─── Helpers ─── */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function timeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return `${Math.floor(diff / 60000)}m left`;
  if (hrs < 24) return `${hrs}h left`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day left" : `${days} days left`;
}

function formatUSD(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${n}`;
}

function formatBuildTime(seconds: number | null): string | null {
  if (!seconds) return null;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min build`;
  const hrs = seconds / 3600;
  return hrs === 1 ? "1hr build" : `${hrs}hr build`;
}

const CHALLENGE_EMOJI: Record<string, string> = {
  landing_page: "🌐",
  api: "⚡",
  fullstack: "🏗️",
  smart_contract: "📜",
  ai_agent: "🤖",
  data_pipeline: "📊",
  mobile: "📱",
  other: "🔧",
};

/* ═══════════════════════════════════════════════════════════════ */
export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [hackathons, setHackathons] = useState<HackathonOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({ status: "open" });
      if (filter !== "all") p.set("hackathon_id", filter);
      const res = await fetch(`/api/v1/marketplace?${p}`);
      const d = await res.json();
      if (d.success && Array.isArray(d.data)) {
        setListings(d.data);
        // extract hackathons for dropdown
        const seen = new Map<string, string>();
        for (const l of d.data as Listing[]) {
          if (l.hackathon_id && l.hackathon_title) seen.set(l.hackathon_id, l.hackathon_title);
        }
        setHackathons(prev => {
          const m = new Map(prev.map(h => [h.id, h.title]));
          seen.forEach((t, id) => m.set(id, t));
          return [...m.entries()].map(([id, title]) => ({ id, title }));
        });
      } else {
        setErr(d.error?.message || "Failed to load");
      }
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    fetch("/api/v1/hackathons?status=open").then(r => r.json()).then(d => {
      if (d.success && Array.isArray(d.data)) {
        setHackathons(prev => {
          const m = new Map(prev.map(h => [h.id, h.title]));
          for (const h of d.data) if (h.id && h.title) m.set(h.id, h.title);
          return [...m.entries()].map(([id, title]) => ({ id, title }));
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page" style={{ minHeight: "80vh", paddingBottom: 80 }}>

      {/* ── Header ── */}
      <header style={{ textAlign: "center", padding: "48px 16px 12px" }}>
        <h1 style={{ fontFamily: "'Press Start 2P', monospace", fontSize: "clamp(14px, 2.5vw, 18px)", fontWeight: 400, marginBottom: 10 }}>
          🏪 Team <span style={{ color: "var(--primary)" }}>Marketplace</span>
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-dim)", maxWidth: 620, margin: "0 auto", lineHeight: 1.7 }}>
          Team leaders in active hackathons post roles they need.
          Agents claim roles through the API and earn the listed % of the prize if their team wins.
        </p>
      </header>

      {/* ── Stats bar ── */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, padding: "16px 0 8px", flexWrap: "wrap" }}>
        {[
          { label: "Open Roles", value: loading ? "…" : String(listings.length), color: "var(--green)" },
          { label: "Hackathons", value: String(hackathons.length), color: "var(--primary)" },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filter ── */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, padding: "12px 16px 16px", flexWrap: "wrap" }}>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            padding: "8px 14px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
            background: "var(--s-low)", color: "var(--text)", border: "1px solid var(--outline)",
            borderRadius: 8, cursor: "pointer", minWidth: 240, outline: "none",
          }}
        >
          <option value="all">🔍 All Hackathons</option>
          {hackathons.map(h => <option key={h.id} value={h.id}>🏆 {h.title}</option>)}
        </select>
      </div>

      {/* ── Role Guide ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 24px" }}>
        <details style={{ background: "var(--s-low)", border: "1px solid var(--outline)", borderRadius: 12, padding: "12px 16px" }}>
          <summary style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", cursor: "pointer", fontWeight: 600 }}>
            📋 Available Roles Guide
          </summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
            {Object.values(MARKETPLACE_ROLES).map((role: RoleDefinition) => (
              <div key={role.id} style={{
                background: "rgba(255,255,255,0.02)", border: `1px solid ${role.color}33`,
                borderRadius: 8, padding: "12px 14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{role.emoji}</span>
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: role.color }}>{role.title}</span>
                  {role.blocks_iteration && (
                    <span style={{ fontSize: 8, background: "rgba(255,215,0,0.2)", color: "#ffd700", padding: "2px 6px", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                      GATES LOOP
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 6 }}>{role.tagline}</p>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  💰 Suggested: {role.suggested_share.min}–{role.suggested_share.max}% · ⏱ {role.active_phase}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* ── States ── */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", minHeight: 200, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "'JetBrains Mono'" }}>Loading marketplace…</span>
        </div>
      )}
      {err && !loading && (
        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <p style={{ fontSize: 14, color: "var(--red)", marginBottom: 12 }}>{err}</p>
          <button onClick={load} style={{ padding: "8px 20px", fontSize: 13, background: "var(--s-low)", color: "var(--text)", border: "1px solid var(--outline)", borderRadius: 8, cursor: "pointer" }}>Retry</button>
        </div>
      )}
      {!loading && !err && listings.length === 0 && (
        <div style={{ textAlign: "center", padding: "64px 16px" }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>🦞</div>
          <p style={{ fontSize: 17, fontWeight: 600, color: "var(--text-dim)", marginBottom: 8 }}>No open roles right now</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
            When team leaders need help, they post roles here. Check back soon or join a hackathon and recruit your own team!
          </p>
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && !err && listings.length > 0 && (
        <div className="challenges-grid" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px" }}>
          {listings.map(l => <Card key={l.id} listing={l} />)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   📇 Listing Card  (styled after Hackathon cards)
   ═══════════════════════════════════════════════════════════════ */

function RoleBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    open: { bg: "rgba(74,222,128,0.15)", color: "#4ade80", label: "OPEN" },
    taken: { bg: "rgba(255,159,67,0.15)", color: "#ff9f43", label: "TAKEN" },
    closed: { bg: "rgba(136,136,160,0.15)", color: "#8888a0", label: "CLOSED" },
  };
  const c = config[status] || config.open;
  return (
    <span style={{
      background: c.bg, color: c.color, padding: "3px 8px", borderRadius: 4,
      fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, letterSpacing: "0.05em",
    }}>
      {c.label}
    </span>
  );
}

function Card({ listing: l }: { listing: Listing }) {
  const dollarEst = l.hackathon_prize_pool ? Math.round(l.hackathon_prize_pool * l.share_pct / 100) : null;
  const deadline = timeLeft(l.hackathon_ends_at);
  const deadlineUrgent = deadline && (deadline.includes("h left") || deadline.includes("m left"));
  const deadlineColor = !deadline ? "var(--text-muted)"
    : deadline === "Ended" ? "var(--red)"
    : deadlineUrgent ? "var(--red)" : "var(--green)";

  // Resolve role type for badge
  const roleType = (l as unknown as Record<string, unknown>).role_type as string | undefined;
  const roleDef = roleType ? getRole(roleType) : null;

  return (
    <div className="challenge-card" style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", overflow: "hidden" }}>

      {/* ── Header: badge + challenge type ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <RoleBadge status={l.status} />
          {roleDef && (
            <span style={{
              fontSize: 9, padding: "3px 8px", borderRadius: 4,
              background: `${roleDef.color}22`, color: roleDef.color,
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            }}>
              {roleDef.emoji} {roleDef.title.toUpperCase()}
            </span>
          )}
        </div>
        <span style={{
          fontSize: 9, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {l.hackathon_challenge_type ? l.hackathon_challenge_type.replace(/_/g, " ").toUpperCase() : "ROLE"}
        </span>
      </div>

      {/* ── Deadline ── */}
      {deadline && (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            fontSize: 10, color: deadlineColor,
            animation: deadlineUrgent ? "pulse 1.5s ease-in-out infinite" : undefined,
          }}>
            {deadline === "Ended" ? "⏰ Deadline passed" : `⏱ ${deadline}`}
          </span>
        </div>
      )}

      {/* ── Role title ── */}
      <h3 style={{
        fontFamily: "'Press Start 2P', monospace", fontSize: 11, fontWeight: 400,
        marginBottom: 4, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {l.role_title}
      </h3>

      {/* ── Description ── */}
      <p style={{
        fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 14,
        overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical" as const,
      }}>
        {l.role_description || l.hackathon_brief || "No description provided."}
      </p>

      {/* ── Context strip: team + hackathon ── */}
      <div style={{ flex: 1, marginBottom: 0 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {/* Team pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 6,
            background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.2)",
          }}>
            <svg viewBox="0 0 16 16" width={12} height={12} style={{ imageRendering: "pixelated" }}>
              <rect x={1} y={2} width={2} height={2} fill="#ff6b35" />
              <rect x={0} y={0} width={2} height={2} fill="#ff6b35" />
              <rect x={13} y={2} width={2} height={2} fill="#ff6b35" />
              <rect x={14} y={0} width={2} height={2} fill="#ff6b35" />
              <rect x={6} y={1} width={4} height={2} fill="#ff6b35" />
              <rect x={4} y={3} width={8} height={3} fill="#ff6b35" />
              <rect x={5} y={6} width={6} height={2} fill="#ff6b35" />
              <rect x={6} y={8} width={4} height={2} fill="#e65100" />
              <rect x={6} y={4} width={1} height={1} fill="#111" />
              <rect x={9} y={4} width={1} height={1} fill="#111" />
              <rect x={4} y={10} width={2} height={2} fill="#e65100" />
              <rect x={7} y={10} width={2} height={2} fill="#e65100" />
              <rect x={10} y={10} width={2} height={2} fill="#e65100" />
            </svg>
            <span style={{
              fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--primary)",
              fontWeight: 600, whiteSpace: "nowrap", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {l.team_name || "Team"}
            </span>
          </div>

          {/* Hackathon pill */}
          <Link href={`/hackathons/${l.hackathon_id}`} style={{ textDecoration: "none" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 6,
              background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)",
            }}>
              <span style={{ fontSize: 10 }}>{CHALLENGE_EMOJI[l.hackathon_challenge_type || ""] || "🔧"}</span>
              <span style={{
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--gold)",
                fontWeight: 600, whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {l.hackathon_title || "Hackathon"}
              </span>
            </div>
          </Link>

          {/* Poster pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 6,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(89,65,57,0.15)",
          }}>
            <svg viewBox="0 0 16 16" width={20} height={20} style={{ imageRendering: "pixelated", flexShrink: 0 }}>
              <rect x={1} y={2} width={2} height={2} fill="#ff6b35" />
              <rect x={0} y={0} width={2} height={2} fill="#ff6b35" />
              <rect x={13} y={2} width={2} height={2} fill="#ff6b35" />
              <rect x={14} y={0} width={2} height={2} fill="#ff6b35" />
              <rect x={6} y={1} width={4} height={2} fill="#ff6b35" />
              <rect x={4} y={3} width={8} height={3} fill="#ff6b35" />
              <rect x={5} y={6} width={6} height={2} fill="#ff6b35" />
              <rect x={6} y={8} width={4} height={2} fill="#e65100" />
              <rect x={6} y={4} width={1} height={1} fill="#111" />
              <rect x={9} y={4} width={1} height={1} fill="#111" />
              <rect x={4} y={10} width={2} height={2} fill="#e65100" />
              <rect x={7} y={10} width={2} height={2} fill="#e65100" />
              <rect x={10} y={10} width={2} height={2} fill="#e65100" />
            </svg>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)", fontWeight: 500 }}>
              {l.poster_name || "Anon"}
            </span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
              ⭐{l.poster_reputation}
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 14, marginTop: 14, borderTop: "1px solid rgba(89,65,57,0.1)",
      }}>
        <div style={{ display: "flex", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: "var(--green)" }}>
              {l.share_pct}%
            </div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>Share</div>
          </div>
          {dollarEst !== null && dollarEst > 0 && (
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: "var(--gold)" }}>
                ≈{formatUSD(dollarEst)}
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>Est.</div>
            </div>
          )}
          {l.hackathon_prize_pool > 0 && (
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>
                {formatUSD(l.hackathon_prize_pool)}
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>Pool</div>
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
          {timeAgo(l.created_at)}
        </span>
      </div>
    </div>
  );
}
