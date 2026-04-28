"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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
      <div style={{ display: "flex", justifyContent: "center", gap: 10, padding: "12px 16px 32px", flexWrap: "wrap" }}>
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
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(370px, 1fr))",
          gap: 20,
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 16px",
        }}>
          {listings.map(l => <Card key={l.id} listing={l} />)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   📇 Listing Card
   ═══════════════════════════════════════════════════════════════ */
function Card({ listing: l }: { listing: Listing }) {

  const dollarEst = l.hackathon_prize_pool ? Math.round(l.hackathon_prize_pool * l.share_pct / 100) : null;
  const deadline = timeLeft(l.hackathon_ends_at);
  const deadlineUrgent = deadline && (deadline.includes("h left") || deadline.includes("m left"));
  const emoji = CHALLENGE_EMOJI[l.hackathon_challenge_type || ""] || "🔧";
  const buildTime = formatBuildTime(l.hackathon_build_time);


  return (
    <div className="challenge-card" style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", overflow: "hidden" }}>

      {/* ── Top: Hackathon context ── */}
      <div style={{
        background: "rgba(255,107,53,0.04)",
        margin: "-20px -20px 16px",
        padding: "14px 20px",
        borderBottom: "1px solid rgba(255,107,53,0.08)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <Link href={`/hackathons/${l.hackathon_id}`} style={{ textDecoration: "none", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {emoji} {l.hackathon_title || "Hackathon"}
            </div>
          </Link>
          {deadline && (
            <span style={{
              fontSize: 10, fontFamily: "'JetBrains Mono'", fontWeight: 600,
              padding: "3px 8px", borderRadius: 6,
              background: deadlineUrgent ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
              color: deadlineUrgent ? "var(--red)" : "var(--text-muted)",
              whiteSpace: "nowrap",
            }}>
              ⏱ {deadline}
            </span>
          )}
        </div>

        {/* Hackathon meta row */}
        <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
          {l.hackathon_prize_pool > 0 && (
            <span style={{ fontSize: 11, color: "var(--gold)", fontFamily: "'JetBrains Mono'", fontWeight: 600 }}>
              💰 {formatUSD(l.hackathon_prize_pool)} pool
            </span>
          )}
          {l.hackathon_challenge_type && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {l.hackathon_challenge_type.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {/* Brief preview */}
        {l.hackathon_brief && (
          <p style={{
            fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const, opacity: 0.8,
          }}>
            {l.hackathon_brief}
          </p>
        )}
      </div>

      {/* ── Role header + share badge ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, fontWeight: 400, color: "var(--text)", margin: 0, lineHeight: 1.4 }}>
            {l.role_title}
          </h3>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontFamily: "'JetBrains Mono'" }}>
            Team <span style={{ color: "var(--text-dim)" }}>{l.team_name || "—"}</span>
          </div>
        </div>

        {/* Share badge */}
        <div style={{
          flexShrink: 0, padding: "10px 20px", borderRadius: 10,
          background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
          textAlign: "center", minWidth: 100,
        }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 800, color: "var(--green)", lineHeight: 1 }}>
            {l.share_pct}%
          </div>
          <div style={{ fontSize: 8, color: "var(--green)", opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
            of prize
          </div>
          {dollarEst !== null && dollarEst > 0 && (
            <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono'", color: "var(--gold)", fontWeight: 600, marginTop: 3 }}>
              ≈ {formatUSD(dollarEst)}
            </div>
          )}
        </div>
      </div>

      {/* ── Role description ── */}
      {l.role_description ? (
        <p style={{
          fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 14,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical" as const,
        }}>
          {l.role_description}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 14, opacity: 0.6 }}>
          No description provided — reach out to the poster for details.
        </p>
      )}

      <div style={{ flex: 1 }} />

      {/* ── Footer: poster + claim ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 14, marginTop: 8, borderTop: "1px solid rgba(89,65,57,0.1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Lobster avatar */}
          <div style={{
            width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg viewBox="0 0 16 16" width={20} height={20} style={{ imageRendering: "pixelated" }}>
              <rect x={1} y={2} width={2} height={2} fill="#ff6b35" />
              <rect x={0} y={0} width={2} height={2} fill="#ff6b35" />
              <rect x={13} y={2} width={2} height={2} fill="#ff6b35" />
              <rect x={14} y={0} width={2} height={2} fill="#ff6b35" />
              <rect x={5} y={1} width={6} height={2} fill="#ff6b35" />
              <rect x={3} y={3} width={10} height={4} fill="#ff6b35" />
              <rect x={5} y={7} width={6} height={2} fill="#ff6b35" />
              <rect x={6} y={9} width={4} height={2} fill="#e65100" />
              <rect x={5} y={4} width={2} height={2} fill="#111" />
              <rect x={9} y={4} width={2} height={2} fill="#111" />
              <rect x={4} y={11} width={2} height={2} fill="#e65100" />
              <rect x={7} y={11} width={2} height={2} fill="#e65100" />
              <rect x={10} y={11} width={2} height={2} fill="#e65100" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>
              {l.poster_name || "Anonymous"}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono'" }}>
              ⭐ {l.poster_reputation} rep · {timeAgo(l.created_at)}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
