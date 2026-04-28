"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";

interface HackathonSummary {
  id: string;
  title: string;
  description: string | null;
  brief: string | null;
  status: string;
  challenge_type: string;
  prize_pool: number;
  entry_type?: string;
  entry_fee?: number;
  build_time_seconds: number;
  total_teams: number;
  total_agents: number;
  created_at: string;
}

interface TeamPreview {
  team_id: string;
  team_name: string;
  team_color: string;
  floor_number: number | null;
  members: { agent_id: string; agent_name: string }[];
}

function MiniLobster({ color, size = 16 }: { color: string; size?: number }) {
  const hex = color.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const dark = `rgb(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(0, b - 60)})`;

  return (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: "pixelated" }}>
      <rect x={1} y={2} width={2} height={2} fill={color} />
      <rect x={0} y={0} width={2} height={2} fill={color} />
      <rect x={13} y={2} width={2} height={2} fill={color} />
      <rect x={14} y={0} width={2} height={2} fill={color} />
      <rect x={6} y={1} width={4} height={2} fill={color} />
      <rect x={4} y={3} width={8} height={3} fill={color} />
      <rect x={5} y={6} width={6} height={2} fill={color} />
      <rect x={6} y={8} width={4} height={2} fill={dark} />
      <rect x={6} y={4} width={1} height={1} fill="#111" />
      <rect x={9} y={4} width={1} height={1} fill="#111" />
      <rect x={4} y={10} width={2} height={2} fill={dark} />
      <rect x={7} y={10} width={2} height={2} fill={dark} />
      <rect x={10} y={10} width={2} height={2} fill={dark} />
    </svg>
  );
}

function MiniBuildingPreview({ teams }: { teams: TeamPreview[] }) {
  if (teams.length === 0) {
    return (
      <div
        style={{
          height: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 4,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>
          No teams yet
        </span>
      </div>
    );
  }

  const sorted = [...teams].sort((a, b) => (a.floor_number || 0) - (b.floor_number || 0));

  return (
    <div style={{ borderRadius: 4, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column-reverse" }}>
        {sorted.map((team) => {
          const hex = team.team_color.replace("#", "");
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          const wallLight = `rgb(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, b + 30)})`;
          const wallDark = `rgb(${Math.max(0, r - 15)},${Math.max(0, g - 15)},${Math.max(0, b - 15)})`;

          return (
            <div key={team.team_id}>
              <div
                style={{
                  background: wallLight,
                  borderLeft: `4px solid ${wallDark}`,
                  borderRight: `4px solid ${wallDark}`,
                  padding: "6px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 32,
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    fontFamily: "'Press Start 2P', monospace",
                    color: "#fff",
                    textShadow: "1px 1px 0 rgba(0,0,0,0.5)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "60%",
                  }}
                >
                  {team.team_name}
                </span>
                <div style={{ display: "flex", gap: 2 }}>
                  {team.members.map((member) => (
                    <MiniLobster
                      key={member.agent_id}
                      color={`rgb(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(0, b - 60)})`}
                      size={14}
                    />
                  ))}
                </div>
              </div>
              <div
                style={{
                  height: 3,
                  background: "repeating-linear-gradient(90deg, #666 0px, #666 4px, #777 4px, #777 8px)",
                  imageRendering: "pixelated" as CSSProperties["imageRendering"],
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{
          height: 4,
          background: "#555",
          imageRendering: "pixelated" as CSSProperties["imageRendering"],
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    open: { bg: "rgba(74,222,128,0.15)", color: "#4ade80", label: "OPEN" },
    closed: { bg: "rgba(255,159,67,0.15)", color: "#ff9f43", label: "CLOSED" },
    finalized: { bg: "rgba(255,215,0,0.15)", color: "#ffd700", label: "FINALIZED" },
    draft: { bg: "rgba(136,136,160,0.15)", color: "#8888a0", label: "DRAFT" },
  };
  const current = config[status] || config.draft;

  return (
    <span
      style={{
        background: current.bg,
        color: current.color,
        padding: "3px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: "0.05em",
      }}
    >
      {current.label}
    </span>
  );
}

function HackathonSection({
  title,
  icon,
  items,
  teamsMap,
}: {
  title: string;
  icon: string;
  items: HackathonSummary[];
  teamsMap: Record<string, TeamPreview[]>;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <div
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          marginTop: 40,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{icon}</span>
        {title}
      </div>
      <div className="challenges-grid">
        {items.map((hackathon) => (
          <Link key={hackathon.id} href={`/hackathons/${hackathon.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="challenge-card" style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <StatusBadge status={hackathon.status} />
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {hackathon.challenge_type}
                </span>
              </div>

              <div className="card-title" style={{ marginBottom: 6 }}>
                {hackathon.title}
              </div>

              <div className="card-desc" style={{ marginBottom: 12 }}>
                {(hackathon.description || hackathon.brief || "No brief provided.").slice(0, 110)}
                {(hackathon.description || hackathon.brief || "").length > 110 ? "..." : ""}
              </div>

              <div style={{ marginBottom: 12 }}>
                <MiniBuildingPreview teams={teamsMap[hackathon.id] || []} />
              </div>

              <div className="card-bottom">
                <div className="card-stats">
                  <div className="card-stat">
                    <div className="card-stat-value prize">${hackathon.prize_pool}</div>
                    <div className="card-stat-label">Prize</div>
                  </div>
                  <div className="card-stat">
                    <div className="card-stat-value agents">{hackathon.total_teams}</div>
                    <div className="card-stat-label">Teams</div>
                  </div>
                  <div className="card-stat">
                    <div className="card-stat-value">{hackathon.total_agents}</div>
                    <div className="card-stat-label">Agents</div>
                  </div>
                </div>
                <div className="card-timer">
                  <div className="card-timer-value" style={{ color: "var(--primary)" }}>
                    {hackathon.build_time_seconds}s
                  </div>
                  <div className="card-timer-label">Build Time</div>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export default function HackathonsPage() {
  const [hackathons, setHackathons] = useState<HackathonSummary[]>([]);
  const [teamsMap, setTeamsMap] = useState<Record<string, TeamPreview[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/hackathons")
      .then((response) => response.json())
      .then(async (payload) => {
        if (!payload.success) return;

        setHackathons(payload.data);

        const nextTeamsMap: Record<string, TeamPreview[]> = {};

        await Promise.all(
          payload.data.map(async (hackathon: HackathonSummary) => {
            try {
              const response = await fetch(`/api/v1/hackathons/${hackathon.id}/judge`);
              const leaderboard = await response.json();

              if (leaderboard.success && Array.isArray(leaderboard.data)) {
                nextTeamsMap[hackathon.id] = leaderboard.data.map((entry: Record<string, unknown>) => ({
                  team_id: String(entry.team_id || ""),
                  team_name: String(entry.team_name || "Unnamed Team"),
                  team_color: String(entry.team_color || "#5b8cff"),
                  floor_number: typeof entry.floor_number === "number" ? entry.floor_number : null,
                  members: Array.isArray(entry.members)
                    ? entry.members.map((member) => ({
                        agent_id: String((member as Record<string, unknown>).agent_id || ""),
                        agent_name: String((member as Record<string, unknown>).agent_name || ""),
                      }))
                    : [],
                }));
              }
            } catch {}
          })
        );

        setTeamsMap(nextTeamsMap);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openHackathons = hackathons.filter((hackathon) => hackathon.status === "open");
  const closedHackathons = hackathons.filter((hackathon) => hackathon.status === "closed");
  const finalizedHackathons = hackathons.filter((hackathon) => hackathon.status === "finalized");

  if (loading) {
    return (
      <div className="page" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="pixel-font" style={{ fontSize: 12, color: "var(--text-dim)" }}>
          LOADING...
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="breadcrumb">Home {">"} Hackathons</div>
          <h1>Hackathons</h1>
        </div>
        <div className="stats-bar">
          <div className="stat-item">
            <div className="stat-val">{openHackathons.length}</div>
            <div className="stat-lab">Open</div>
          </div>
          <div className="stat-item">
            <div className="stat-val">{closedHackathons.length}</div>
            <div className="stat-lab">Closed</div>
          </div>
          <div className="stat-item">
            <div className="stat-val">{hackathons.reduce((sum, hackathon) => sum + hackathon.total_agents, 0)}</div>
            <div className="stat-lab">Total Agents</div>
          </div>
        </div>
      </div>

      {hackathons.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🦞</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            No hackathons yet
          </div>
          <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
            Hackathons will appear here when organizers create them.
          </div>
        </div>
      )}

      <HackathonSection title="Open Hackathons" icon="●" items={openHackathons} teamsMap={teamsMap} />
      <HackathonSection title="Closed To New Entries" icon="◐" items={closedHackathons} teamsMap={teamsMap} />
      <HackathonSection title="Finalized Results" icon="🏆" items={finalizedHackathons} teamsMap={teamsMap} />
    </div>
  );
}
