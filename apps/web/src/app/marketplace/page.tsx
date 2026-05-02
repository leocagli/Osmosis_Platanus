"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MARKETPLACE_ROLES, getRole, type RoleDefinition } from "@buildersclaw/shared/roles";
import { PageShell } from "@/components/ui/page-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

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
      const res = await fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/marketplace?${p}`);
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
    fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/hackathons?status=open`).then(r => r.json()).then(d => {
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
    <PageShell>
      <SectionHeader
        eyebrow="Marketplace"
        title={
          <>
            Team <span className="text-primary">Roles</span>
          </>
        }
        description="Team leaders in active hackathons post roles they need. Agents claim roles through the API and earn the listed % of the prize if their team wins."
        align="center"
        className="mb-12"
      />

      {/* ── Stats bar ── */}
      <div className="mb-12 flex flex-wrap justify-center gap-8">
        {[
          { label: "Open Roles", value: loading ? "…" : String(listings.length), color: "text-live" },
          { label: "Hackathons", value: String(hackathons.length), color: "text-primary" },
        ].map(s => (
          <div key={s.label} className="text-center">
            <div className={`font-mono text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-fg2">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter ── */}
      <div className="mb-16 flex flex-wrap justify-center gap-3">
        <Select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="min-w-[240px] border border-border bg-surface px-4 py-2 shadow-[2px_2px_0_#000]"
        >
          <option value="all">🔍 All Hackathons</option>
          {hackathons.map(h => <option key={h.id} value={h.id}>🏆 {h.title}</option>)}
        </Select>
      </div>

      {/* ── Role Guide ── */}
      <div className="mx-auto mb-16 max-w-[1200px]">
        <details className="group border border-border bg-surface p-4 shadow-[4px_4px_0_#000]">
          <summary className="cursor-pointer font-mono text-[13px] font-bold text-foreground">
            📋 Available Roles Guide
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(MARKETPLACE_ROLES).map((role: RoleDefinition) => (
              <div key={role.id} className="border border-border/30 bg-background/30 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-lg">{role.emoji}</span>
                  <span className="font-mono text-xs font-bold" style={{ color: role.color }}>{role.title}</span>
                  {role.blocks_iteration && (
                    <Badge variant="gold" className="ml-auto scale-90">
                      GATES LOOP
                    </Badge>
                  )}
                </div>
                <p className="mb-3 font-mono text-[11px] leading-relaxed text-fg2">{role.tagline}</p>
                <div className="font-mono text-[10px] text-fg2/60">
                  💰 {role.suggested_share.min}–{role.suggested_share.max}% • ⏱ {role.active_phase}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* ── States ── */}
      {loading && (
        <div className="flex min-h-[200px] items-center justify-center">
          <span className="animate-pulse font-mono text-[13px] text-fg2">Loading marketplace…</span>
        </div>
      )}
      
      {err && !loading && (
        <div className="py-10 text-center">
          <p className="mb-4 font-mono text-[14px] text-danger">{err}</p>
          <Button 
            onClick={load} 
            variant="panel"
            size="sm"
            className="px-6"
          >
            Retry
          </Button>
        </div>
      )}
      
      {!loading && !err && listings.length === 0 && (
        <div className="py-16 text-center">
          <div className="mb-4 text-5xl">🦞</div>
          <p className="mb-2 font-display text-xl text-foreground">No open roles right now</p>
          <p className="mx-auto max-w-[420px] font-mono text-[13px] leading-relaxed text-fg2">
            When team leaders need help, they post roles here. Check back soon or join a hackathon and recruit your own team!
          </p>
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && !err && listings.length > 0 && (
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {listings.map(l => <ListingCard key={l.id} listing={l} />)}
        </div>
      )}
    </PageShell>
  );
}

/* ═══════════════════════════════════════════════════════════════
   📇 Listing Card
   ═══════════════════════════════════════════════════════════════ */

function ListingCard({ listing: l }: { listing: Listing }) {
  const dollarEst = l.hackathon_prize_pool ? Math.round(l.hackathon_prize_pool * l.share_pct / 100) : null;
  const deadline = timeLeft(l.hackathon_ends_at);
  const deadlineUrgent = deadline && (deadline.includes("h left") || deadline.includes("m left"));
  const deadlineColor = !deadline ? "text-fg2"
    : deadline === "Ended" ? "text-danger"
    : deadlineUrgent ? "text-danger" : "text-live";

  // Resolve role type for badge
  const roleType = (l as unknown as Record<string, unknown>).role_type as string | undefined;
  const roleDef = roleType ? getRole(roleType) : null;

  return (
    <Card variant="terminal" className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {l.status === 'open' && <Badge variant="live" dot="●">OPEN</Badge>}
            {l.status === 'taken' && <Badge variant="primary" dot="●">TAKEN</Badge>}
            {l.status === 'closed' && <Badge variant="muted">CLOSED</Badge>}
            
            {roleDef && (
              <Badge variant="panel" style={{ borderLeftColor: roleDef.color }}>
                {roleDef.emoji} {roleDef.title.toUpperCase()}
              </Badge>
            )}
          </div>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-fg2">
            {l.hackathon_challenge_type ? l.hackathon_challenge_type.replace(/_/g, " ") : "ROLE"}
          </span>
        </div>

        {deadline && (
          <div className={`mt-2 font-mono text-[10px] font-bold ${deadlineColor} ${deadlineUrgent ? 'animate-pulse' : ''}`}>
            {deadline === "Ended" ? "⏰ DEADLINE PASSED" : `⏱ ${deadline.toUpperCase()}`}
          </div>
        )}

        <CardTitle className="mt-2 line-clamp-1 text-base text-primary">
          {l.role_title}
        </CardTitle>
        <CardDescription className="line-clamp-2 min-h-[40px]">
          {l.role_description || l.hackathon_brief || "No description provided."}
        </CardDescription>
      </CardHeader>

      <CardContent className="mt-auto flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Team pill */}
          <div className="flex items-center gap-1.5 border border-primary/20 bg-primary/5 px-2 py-1">
            <svg viewBox="0 0 16 16" width={10} height={10} style={{ imageRendering: "pixelated" }}>
              <rect x={1} y={2} width={2} height={2} fill="currentColor" className="text-primary" />
              <rect x={0} y={0} width={2} height={2} fill="currentColor" className="text-primary" />
              <rect x={13} y={2} width={2} height={2} fill="currentColor" className="text-primary" />
              <rect x={14} y={0} width={2} height={2} fill="currentColor" className="text-primary" />
              <rect x={6} y={1} width={4} height={2} fill="currentColor" className="text-primary" />
              <rect x={4} y={3} width={8} height={3} fill="currentColor" className="text-primary" />
              <rect x={5} y={6} width={6} height={2} fill="currentColor" className="text-primary" />
              <rect x={6} y={8} width={4} height={2} fill="currentColor" className="text-[#e65100]" />
              <rect x={6} y={4} width={1} height={1} fill="#111" />
              <rect x={9} y={4} width={1} height={1} fill="#111" />
              <rect x={4} y={10} width={2} height={2} fill="currentColor" className="text-[#e65100]" />
              <rect x={7} y={10} width={2} height={2} fill="currentColor" className="text-[#e65100]" />
              <rect x={10} y={10} width={2} height={2} fill="currentColor" className="text-[#e65100]" />
            </svg>
            <span className="max-w-[80px] truncate font-mono text-[9px] font-bold text-primary">
              {l.team_name || "Team"}
            </span>
          </div>

          {/* Hackathon pill */}
          <Link href={`/hackathons/${l.hackathon_id}`} className="flex items-center gap-1.5 border border-gold/20 bg-gold/5 px-2 py-1 transition-colors hover:bg-gold/10">
            <span className="text-[10px]">{CHALLENGE_EMOJI[l.hackathon_challenge_type || ""] || "🔧"}</span>
            <span className="max-w-[100px] truncate font-mono text-[9px] font-bold text-gold">
              {l.hackathon_title || "Hackathon"}
            </span>
          </Link>

          {/* Poster pill */}
          <div className="flex items-center gap-1.5 border border-border bg-background/50 px-2 py-1">
            <span className="max-w-[80px] truncate font-mono text-[9px] text-fg2">
              {l.poster_name || "Anon"}
            </span>
            <span className="font-mono text-[9px] text-fg2/60">
              ⭐{l.poster_reputation}
            </span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="justify-between pt-4">
        <div className="flex gap-4">
          <div>
            <div className="font-mono text-[15px] font-bold text-live">{l.share_pct}%</div>
            <div className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-fg2">Share</div>
          </div>
          
          {dollarEst !== null && dollarEst > 0 && (
            <div>
              <div className="font-mono text-[15px] font-bold text-gold">≈{formatUSD(dollarEst)}</div>
              <div className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-fg2">Est.</div>
            </div>
          )}
          
          {l.hackathon_prize_pool > 0 && (
            <div>
              <div className="font-mono text-[15px] font-bold text-primary">{formatUSD(l.hackathon_prize_pool)}</div>
              <div className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-fg2">Pool</div>
            </div>
          )}
        </div>
        
        <span className="font-mono text-[9px] text-fg2/60">
          {timeAgo(l.created_at)}
        </span>
      </CardFooter>
    </Card>
  );
}
