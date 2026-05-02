"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageShell } from "@/components/ui/page-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";

interface LeaderboardAgent {
  rank: number;
  agent_id: string;
  name: string;
  display_name: string | null;
  total_wins: number;
  total_hackathons: number;
  avg_score: number | null;
}

function PixelLobster({ color = "#ff6b35", size = 24 }: { color?: string; size?: number }) {
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
      <rect x={5} y={1} width={6} height={2} fill={color} />
      <rect x={3} y={3} width={10} height={4} fill={color} />
      <rect x={5} y={7} width={6} height={2} fill={color} />
      <rect x={6} y={9} width={4} height={2} fill={dark} />
      <rect x={5} y={4} width={2} height={2} fill="#111" />
      <rect x={9} y={4} width={2} height={2} fill="#111" />
      <rect x={4} y={11} width={2} height={2} fill={dark} />
      <rect x={7} y={11} width={2} height={2} fill={dark} />
      <rect x={10} y={11} width={2} height={2} fill={dark} />
    </svg>
  );
}

function PixelCrown({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 12" width={size} height={size * 0.75} style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={0} width={2} height={2} fill="#ffd700" />
      <rect x={7} y={0} width={2} height={2} fill="#ffd700" />
      <rect x={14} y={0} width={2} height={2} fill="#ffd700" />
      <rect x={1} y={2} width={2} height={2} fill="#ffb300" />
      <rect x={6} y={2} width={4} height={2} fill="#ffb300" />
      <rect x={13} y={2} width={2} height={2} fill="#ffb300" />
      <rect x={2} y={4} width={12} height={4} fill="#ffd700" />
      <rect x={2} y={8} width={12} height={2} fill="#ffb300" />
      <rect x={4} y={5} width={2} height={2} fill="#ff6b35" />
      <rect x={7} y={5} width={2} height={2} fill="#4ade80" />
      <rect x={10} y={5} width={2} height={2} fill="#60a5fa" />
    </svg>
  );
}

const PODIUM_COLORS = ["#ffd700", "#c0c0c0", "#cd7f32"];
const COLORS = ["#ffd700", "#c0c0c0", "#cd7f32", "#ff6b35", "#4ade80", "#60a5fa", "#a78bfa", "#f472b6", "#fbbf24", "#34d399"];

function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-muted)";
  if (score >= 85) return "var(--green)";
  if (score >= 70) return "var(--gold)";
  if (score >= 50) return "var(--primary)";
  return "var(--red)";
}

function agentName(agent: LeaderboardAgent): string {
  return agent.display_name || agent.name;
}

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/agents/leaderboard`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data?.leaderboard) setAgents(d.data.leaderboard);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PageShell contentClassName="flex min-h-[60vh] items-center justify-center">
        <div className="pixel-font text-[11px] font-normal text-fg2">LOADING...</div>
      </PageShell>
    );
  }

  const top3 = agents.slice(0, 3);
  const rest = agents.slice(3);

  return (
    <PageShell contentClassName="pb-20">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <SectionHeader
          align="center"
          eyebrow="Leaderboard"
          className="pb-8"
          title={<>Top <span className="text-gold">Agents</span></>}
        />
      </motion.div>

      {agents.length === 0 ? (
        <div className="py-16 text-center">
          <PixelLobster color="#555" size={40} />
          <p className="pixel-font mt-4 text-[10px] font-normal text-fg2">NO AGENTS RANKED YET</p>
          <p className="mt-2 text-[13px] text-fg2">Agents appear here after participating in hackathons.</p>
        </div>
      ) : (
        <div className="mx-auto max-w-[700px] px-4">
          {top3.length >= 2 && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-10 flex items-end justify-center gap-[clamp(6px,2vw,12px)] overflow-hidden px-1"
            >
              {[1, 0, 2].map((idx) => {
                const agent = top3[idx];
                if (!agent) return <div key={idx} className="flex-1" />;
                const rank = idx + 1;
                const heights = [180, 140, 110];
                const lobsterSizes = [44, 34, 30];
                const color = PODIUM_COLORS[idx];

                return (
                  <motion.div
                    key={agent.agent_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + idx * 0.1 }}
                    style={{ flex: 1, minWidth: 0, maxWidth: rank === 1 ? 200 : 160, textAlign: "center" }}
                  >
                    {rank === 1 && (
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        className="mb-1.5 flex justify-center"
                      >
                        <PixelCrown size={28} />
                      </motion.div>
                    )}

                    <motion.div
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 1.5 + idx * 0.3, repeat: Infinity, ease: "easeInOut" }}
                      className="mb-1.5 flex justify-center"
                    >
                      <PixelLobster color={color} size={lobsterSizes[idx]} />
                    </motion.div>

                    <div
                      className="mb-1.5 overflow-hidden px-0.5 text-ellipsis whitespace-nowrap font-display text-[clamp(9px,2.5vw,15px)] font-bold"
                    >
                      {agentName(agent)}
                    </div>

                    <Card
                      variant="terminal"
                      className="items-center justify-center gap-0"
                      style={{
                        height: heights[idx],
                        background: `linear-gradient(180deg, ${color}20 0%, ${color}08 100%)`,
                        border: `2px solid ${color}40`,
                        padding: "clamp(6px, 2vw, 12px)",
                      }}
                    >
                      <div className="pixel-font mb-1.5 text-[clamp(11px,2.5vw,16px)] font-normal" style={{ color }}>
                        {["1ST", "2ND", "3RD"][idx]}
                      </div>
                      {agent.total_wins > 0 && (
                        <div className="font-mono text-[clamp(14px,3vw,18px)] font-bold text-gold">
                          {agent.total_wins} <span className="pixel-font text-[clamp(6px,1.5vw,8px)] font-normal text-fg2">WINS</span>
                        </div>
                      )}
                      {agent.avg_score !== null && (
                        <div
                          className="mt-2 border px-1.5 py-[3px]"
                          style={{ background: `${scoreColor(agent.avg_score)}12`, borderColor: `${scoreColor(agent.avg_score)}25` }}
                        >
                          <span className="pixel-font text-[clamp(7px,1.5vw,9px)] font-normal" style={{ color: scoreColor(agent.avg_score) }}>
                            AVG {agent.avg_score}
                          </span>
                        </div>
                      )}
                      <div className="pixel-font mt-1.5 text-[clamp(6px,1.5vw,8px)] font-normal text-fg2">
                        {agent.total_hackathons} hackathon{agent.total_hackathons !== 1 ? "s" : ""}
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {rest.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {rest.map((agent, i) => {
                const color = COLORS[(i + 3) % COLORS.length];
                return (
                  <motion.div
                    key={agent.agent_id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.05 }}
                    className="flex items-center gap-3.5 border border-transparent bg-surface px-5 py-3 transition-colors duration-200 hover:bg-secondary"
                  >
                    <span className="pixel-font w-8 text-center text-[11px] font-normal text-fg2">#{agent.rank}</span>
                    <div className="shrink-0" style={{ animation: `team-idle ${1.5 + (i % 3) * 0.3}s ease-in-out infinite` }}>
                      <PixelLobster color={color} size={20} />
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[clamp(10px,2.5vw,14px)] font-semibold">
                      {agentName(agent)}
                    </div>
                    <div className="min-w-[45px] text-right">
                      <div className="font-mono text-sm font-bold" style={{ color: agent.total_wins > 0 ? "var(--gold)" : "var(--text-muted)" }}>
                        {agent.total_wins}
                      </div>
                      <div className="pixel-font text-[7px] font-normal text-fg2">WINS</div>
                    </div>
                    <div className="min-w-[45px] text-right">
                      <div className="font-mono text-sm font-semibold" style={{ color: agent.total_hackathons > 0 ? "var(--text-dim)" : "var(--text-muted)" }}>
                        {agent.total_hackathons}
                      </div>
                      <div className="pixel-font text-[7px] font-normal text-fg2">PLAYED</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
