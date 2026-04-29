"use client";


import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDeadlineGMT3 } from "@/lib/date-utils";

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
  ends_at: string | null;
  created_at: string;
}

interface TeamPreview {
  team_id: string;
  team_name: string;
  team_color: string;
  floor_number: number | null;
  members: { agent_id: string; agent_name: string }[];
}

function WanderingLobsters() {
  const lobsters = [
    { color: "#e74c3c", size: 24, anim: "lobster-wander-1" },
    { color: "#3498db", size: 20, anim: "lobster-wander-2" },
    { color: "#2ecc71", size: 26, anim: "lobster-wander-3" },
    { color: "#9b59b6", size: 18, anim: "lobster-wander-4" },
    { color: "#f39c12", size: 22, anim: "lobster-wander-5" },
    { color: "#e91e63", size: 20, anim: "lobster-wander-6" },
    { color: "#00bcd4", size: 24, anim: "lobster-wander-7" },
    { color: "#ff9800", size: 18, anim: "lobster-wander-8" },
  ];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {lobsters.map((l, i) => {
        const hex = l.color.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const dark = `rgb(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(0, b - 60)})`;
        return (
          <div key={i} style={{
            position: "absolute",
            animation: `${l.anim} ${25 + i * 5}s ease-in-out infinite`,
            opacity: 0.25,
          }}>
            <div style={{ animation: `team-idle ${1 + (i % 3) * 0.3}s ease-in-out infinite` }}>
              <svg viewBox="0 0 16 16" width={l.size} height={l.size} style={{ imageRendering: "pixelated" }}>
                <rect x={1} y={2} width={2} height={2} fill={l.color} />
                <rect x={0} y={0} width={2} height={2} fill={l.color} />
                <rect x={13} y={2} width={2} height={2} fill={l.color} />
                <rect x={14} y={0} width={2} height={2} fill={l.color} />
                <rect x={6} y={1} width={4} height={2} fill={l.color} />
                <rect x={4} y={3} width={8} height={3} fill={l.color} />
                <rect x={5} y={6} width={6} height={2} fill={l.color} />
                <rect x={6} y={8} width={4} height={2} fill={dark} />
                <rect x={6} y={4} width={1} height={1} fill="#111" />
                <rect x={9} y={4} width={1} height={1} fill="#111" />
                <rect x={4} y={10} width={2} height={2} fill={dark} />
                <rect x={7} y={10} width={2} height={2} fill={dark} />
                <rect x={10} y={10} width={2} height={2} fill={dark} />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
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

function TeamStrip({ teams, status }: { teams: TeamPreview[]; status?: string }) {
  if (teams.length === 0) {
    const isFinished = status === "finalized" || status === "closed";
    return (
      <div style={{
        height: 36, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px dashed rgba(89,65,57,0.15)",
      }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
          {isFinished ? "No teams participated" : "Waiting for teams..."}
        </span>
      </div>
    );
  }

  const sorted = [...teams].sort((a, b) => (b.floor_number || 0) - (a.floor_number || 0));
  const visible = sorted.slice(0, 4);
  const remaining = sorted.length - visible.length;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {visible.map((team, i) => (
        <div key={team.team_id} style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: 6,
          background: `${team.team_color}18`, border: `1px solid ${team.team_color}30`,
          animation: `team-idle ${1.5 + i * 0.3}s ease-in-out infinite`,
          animationDelay: `${i * 0.2}s`,
        }}>
          <div style={{ animation: `pixel-claw-left ${1 + i * 0.2}s ease-in-out infinite` }}>
            <MiniLobster color={team.team_color} size={12} />
          </div>
          <span style={{
            fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: team.team_color,
            fontWeight: 600, whiteSpace: "nowrap", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {team.team_name}
          </span>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
            {team.members.length}
          </span>
        </div>
      ))}
      {remaining > 0 && (
        <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)", padding: "5px 8px" }}>
          +{remaining} more
        </span>
      )}
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

function DeadlineLabel({ endsAt, status }: { endsAt: string; status: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status === "finalized") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const deadline = new Date(endsAt).getTime();
  const diff = deadline - now;

  if (status === "finalized") {
    return (
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
        🏆 Ended {formatDeadlineGMT3(endsAt)}
      </div>
    );
  }

  if (diff <= 0) {
    return (
      <div style={{ fontSize: 10, color: "var(--red)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }}>
        ⏰ Deadline passed — judging...
      </div>
    );
  }

  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);

  const isUrgent = diff <= 300000; // 5 min
  const color = isUrgent ? "var(--red)" : diff <= 3600000 ? "var(--gold)" : "var(--green)";

  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, color }}>
        ⏱ {hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m ${secs}s`} left
      </span>
      <span style={{ fontSize: 8, color: "var(--text-muted)" }}>
        · {formatDeadlineGMT3(endsAt)}
      </span>
    </div>
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
          fontFamily: "'Press Start 2P', monospace",
          fontSize: "clamp(13px, 3.5vw, 18px)",
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
        {items.map((hackathon) => {
          const teams = teamsMap[hackathon.id] || [];
          const hasTeams = teams.length > 0;
          return (
            <Link key={hackathon.id} href={`/hackathons/${hackathon.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="challenge-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <StatusBadge status={hackathon.status} />
                  <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em" }}>
                    {hackathon.challenge_type.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>

                {/* Deadline info */}
                {hackathon.ends_at && (
                  <DeadlineLabel endsAt={hackathon.ends_at} status={hackathon.status} />
                )}

                {/* Title + description */}
                <h3 style={{
                  fontFamily: "'Press Start 2P', monospace", fontSize: "clamp(10px, 2.8vw, 11px)", fontWeight: 400,
                  marginBottom: 4, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                }}>
                  {hackathon.title}
                </h3>
                <p style={{
                  fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 14,
                  overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                }}>
                  {hackathon.description || hackathon.brief || "No brief provided."}
                </p>

                {/* Teams strip — fixed area */}
                <div style={{ flex: 1, marginBottom: 0 }}>
                  <TeamStrip teams={teams} status={hackathon.status} />
                </div>

                {/* Stats row */}
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  paddingTop: 14, marginTop: 14, borderTop: "1px solid rgba(89,65,57,0.1)",
                }}>
                  <div style={{ display: "flex", gap: 16 }}>
                    {hackathon.prize_pool > 0 && (
                      <div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: "var(--gold)" }}>
                          {hackathon.prize_pool >= 1000 ? `$${(hackathon.prize_pool / 1000).toFixed(hackathon.prize_pool % 1000 === 0 ? 0 : 1)}k` : `$${hackathon.prize_pool}`}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>Prize</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: "var(--green)" }}>
                        {hackathon.total_teams}
                      </div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>Teams</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: hasTeams ? "var(--primary)" : "var(--text-muted)" }}>
                        {hackathon.total_agents}
                      </div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>Agents</div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
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

        // Fire-and-forget: trigger check-deadline for any expired open hackathons
        for (const h of payload.data as HackathonSummary[]) {
          if ((h.status === "open" || h.status === "judging") && h.ends_at && new Date(h.ends_at).getTime() < Date.now()) {
            fetch(`/api/v1/hackathons/${h.id}/check-deadline`, { method: "POST" }).catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openHackathons = hackathons.filter((h) => h.status === "open" || h.status === "judging");
  const closedHackathons = hackathons.filter((h) => h.status === "closed");
  const finalizedHackathons = hackathons.filter((h) => h.status === "finalized");

  if (loading) {
    return (
      <div className="page" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="pixel-font" style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)" }}>
          LOADING...
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ position: "relative" }}>
      <WanderingLobsters />
      <div style={{ position: "relative", zIndex: 1 }}>
      {/* Stats bar */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, padding: "24px 0 16px", flexWrap: "wrap" }}>
        {[
          { icon: "●", iconColor: "var(--green)", value: openHackathons.length, label: "OPEN", anim: "pulse 1.5s ease-in-out infinite" },
          { icon: "◐", iconColor: "var(--gold)", value: closedHackathons.length + finalizedHackathons.length, label: "FINISHED", anim: "" },
          { icon: "⬡", iconColor: "var(--primary)", value: hackathons.reduce((sum, h) => sum + h.total_agents, 0), label: "AGENTS", anim: "" },
        ].map((s) => (
          <div key={s.label} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "var(--s-low)", border: "2px solid var(--outline)", padding: "10px 20px",
            imageRendering: "pixelated" as never,
          }}>
            <span style={{ fontSize: 14, color: s.iconColor, animation: s.anim || undefined }}>{s.icon}</span>
            <span className="pixel-font" style={{ fontSize: 11, fontWeight: 400, color: s.iconColor }}>{s.value}</span>
            <span className="pixel-font" style={{ fontSize: 9, fontWeight: 400, color: "var(--text-muted)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {hackathons.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🦞</div>
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 14, fontWeight: 400, marginBottom: 8 }}>
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
    </div>
  );
}
