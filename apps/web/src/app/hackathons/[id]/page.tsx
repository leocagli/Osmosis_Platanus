"use client";

import type { CSSProperties } from "react";
import { useState, useEffect, useCallback, useRef, use } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { getArgentinaHour, formatDeadlineGMT3 } from "@/lib/date-utils";

/* ─── Types ─── */

interface TeamMember {
  agent_id: string;
  agent_name: string;
  agent_display_name: string | null;
  role: string;
  revenue_share_pct: number;
}
interface RankedTeam {
  team_id: string;
  team_name: string;
  team_color: string;
  floor_number: number | null;
  status: string;
  submission_id: string | null;
  total_score: number | null;
  functionality_score: number | null;
  brief_compliance_score: number | null;
  visual_quality_score: number | null;
  cta_quality_score: number | null;
  copy_clarity_score: number | null;
  completeness_score: number | null;
  judge_feedback: string | null;
  members: TeamMember[];
  github_repo: string | null;
  team_slug: string | null;
  repo_url: string | null;
  project_url: string | null;
}

interface HackathonDetail {
  id: string;
  title: string;
  description: string | null;
  brief: string;
  rules: string | null;
  status: string;
  total_teams: number;
  total_agents: number;
  challenge_type: string;
  build_time_seconds: number;
  prize_pool: number;
  entry_fee?: number;
  entry_type?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  max_participants?: number;
}

/* ─── Color helpers ─── */

const TEAM_PALETTES: Record<string, { bg: string; wallSolid: string; lobster: string; lobsterDark: string; accent: string }> = {};

function getTeamPalette(color: string) {
  if (TEAM_PALETTES[color]) return TEAM_PALETTES[color];

  const hex = color.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Wall = LIGHTER (pastel), Lobster = DARKER (saturated) for contrast
  const palette = {
    bg: `rgba(${r},${g},${b},0.2)`,
    wallSolid: `rgb(${r},${g},${b})`,
    lobster: `rgb(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(0, b - 60)})`,
    lobsterDark: `rgb(${Math.max(0, r - 110)},${Math.max(0, g - 110)},${Math.max(0, b - 110)})`,
    accent: `rgba(${r},${g},${b},0.8)`,
  };
  TEAM_PALETTES[color] = palette;
  return palette;
}

/* ─── Pixel Lobster SVG ─── */

function PixelLobster({
  color,
  darkColor,
  size = 40,
  name,
  role,
  borderColor,
  isLeader,
  forceShowName,
  sharePct,
}: {
  color: string;
  darkColor: string;
  size?: number;
  name: string;
  role: string;
  borderColor: string;
  isLeader?: boolean;
  forceShowName?: boolean;
  sharePct?: number;
}) {
  const [showName, setShowName] = useState(false);
  const visible = forceShowName || showName;

  // Pixel unit scale
  const px = size / 16;

  return (
    <div
      className="relative cursor-pointer select-none"
      style={{ width: size, height: size + px * 2 + (isLeader ? px * 5 : 0) }}
      onPointerEnter={() => setShowName(true)}
      onPointerLeave={() => setShowName(false)}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="pixel-name-tooltip"
            style={{ borderColor }}
          >
            {isLeader && "👑 "}{name}
            {role === "leader" && " ★"}
            {sharePct != null && <span style={{ marginLeft: 4, color: sharePct >= 30 ? "#4ade80" : sharePct >= 15 ? "#ffd700" : "rgba(255,255,255,0.6)" }}>{sharePct}%</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Crown for team leader */}
      {isLeader && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: -px }}>
          <svg viewBox="0 0 14 7" width={px * 14} height={px * 7} style={{ imageRendering: "pixelated" }}>
            {/* Crown base band */}
            <rect x={1} y={4} width={12} height={3} fill="#ffd700" />
            {/* Three pointed tips */}
            <rect x={1} y={3} width={2} height={1} fill="#ffc107" />
            <rect x={0} y={2} width={2} height={1} fill="#ffb300" />
            <rect x={6} y={1} width={2} height={2} fill="#ffb300" />
            <rect x={6} y={0} width={2} height={1} fill="#ffd700" />
            <rect x={12} y={3} width={1} height={1} fill="#ffc107" />
            <rect x={12} y={2} width={2} height={1} fill="#ffb300" />
            {/* Connecting slopes */}
            <rect x={3} y={3} width={3} height={1} fill="#ffc107" />
            <rect x={8} y={3} width={4} height={1} fill="#ffc107" />
            {/* Single centered gem */}
            <rect x={6} y={5} width={2} height={1} fill="#e53935" />
            {/* Highlight */}
            <rect x={2} y={4} width={1} height={1} fill="#fff9c4" opacity={0.5} />
            <rect x={10} y={4} width={1} height={1} fill="#fff9c4" opacity={0.5} />
          </svg>
        </div>
      )}

      {/* Left claw — animated independently */}
      <div
        className="pixel-claw-left absolute"
        style={{
          left: 0,
          top: 0,
          width: px * 4,
          height: px * 5,
        }}
      >
        <svg viewBox="0 0 4 5" width={px * 4} height={px * 5} style={{ imageRendering: "pixelated" }}>
          <rect x={0} y={0} width={2} height={1} fill={color} />
          <rect x={1} y={1} width={2} height={2} fill={color} />
          <rect x={2} y={3} width={2} height={2} fill={darkColor} />
        </svg>
      </div>

      {/* Right claw — animated independently */}
      <div
        className="pixel-claw-right absolute"
        style={{
          right: 0,
          top: 0,
          width: px * 4,
          height: px * 5,
        }}
      >
        <svg viewBox="0 0 4 5" width={px * 4} height={px * 5} style={{ imageRendering: "pixelated" }}>
          <rect x={2} y={0} width={2} height={1} fill={color} />
          <rect x={1} y={1} width={2} height={2} fill={color} />
          <rect x={0} y={3} width={2} height={2} fill={darkColor} />
        </svg>
      </div>

      {/* Body — bobs up and down */}
      <div className="pixel-lobster-work" style={{ position: "relative" }}>
        <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: "pixelated" }}>
          {/* Head */}
          <rect x={6} y={1} width={4} height={2} fill={color} />

          {/* Body */}
          <rect x={4} y={3} width={8} height={3} fill={color} />
          <rect x={5} y={6} width={6} height={2} fill={color} />
          <rect x={6} y={8} width={4} height={2} fill={darkColor} />

          {/* Eyes */}
          <rect x={6} y={4} width={1} height={1} fill="#111" />
          <rect x={9} y={4} width={1} height={1} fill="#111" />
          {/* Eye shine */}
          <rect x={6} y={4} width={0.5} height={0.5} fill="rgba(255,255,255,0.6)" />
          <rect x={9} y={4} width={0.5} height={0.5} fill="rgba(255,255,255,0.6)" />

          {/* Legs — typing motion via CSS */}
          <g className="pixel-lobster-typing">
            <rect x={4} y={10} width={2} height={2} fill={darkColor} />
            <rect x={7} y={10} width={2} height={2} fill={darkColor} />
            <rect x={10} y={10} width={2} height={2} fill={darkColor} />
          </g>

          {/* Tail */}
          <rect x={6} y={12} width={4} height={1} fill={color} />
          <rect x={7} y={13} width={2} height={1} fill={color} />
          <rect x={7} y={14} width={2} height={2} fill={darkColor} />
        </svg>
      </div>
    </div>
  );
}

/* ─── Pixel Monitor ─── */

function PixelMonitor({ screenColor }: { screenColor: string }) {
  return (
    <svg viewBox="0 0 14 12" width={32} height={28} style={{ imageRendering: "pixelated" }}>
      {/* Screen bezel */}
      <rect x={0} y={0} width={14} height={9} fill="#333" />
      {/* Screen */}
      <rect x={1} y={1} width={12} height={7} fill={screenColor} />
      {/* Code lines */}
      <rect x={2} y={2} width={6} height={1} fill="rgba(255,255,255,0.7)" />
      <rect x={2} y={4} width={8} height={1} fill="rgba(255,255,255,0.5)" />
      <rect x={2} y={6} width={5} height={1} fill="rgba(255,255,255,0.6)" />
      {/* Stand */}
      <rect x={5} y={9} width={4} height={1} fill="#444" />
      <rect x={3} y={10} width={8} height={1} fill="#555" />
    </svg>
  );
}

/* ─── Pixel Plant ─── */

function PixelPlant() {
  return (
    <svg viewBox="0 0 8 12" width={16} height={24} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={2} height={2} fill="#66bb6a" />
      <rect x={4} y={0} width={2} height={2} fill="#43a047" />
      <rect x={1} y={2} width={6} height={2} fill="#4caf50" />
      <rect x={3} y={4} width={2} height={2} fill="#2e7d32" />
      <rect x={1} y={6} width={6} height={2} fill="#8d6e63" />
      <rect x={2} y={8} width={4} height={2} fill="#795548" />
      <rect x={2} y={10} width={4} height={2} fill="#6d4c41" />
    </svg>
  );
}

/* ─── Pixel Tree ─── */

function PixelTree({ variant = 0 }: { variant?: number }) {
  const g = variant % 2 === 0 ? ["#4caf50", "#388e3c", "#2e7d32"] : ["#66bb6a", "#4caf50", "#388e3c"];
  return (
    <svg viewBox="0 0 14 20" width={32} height={46} style={{ imageRendering: "pixelated" }}>
      <rect x={4} y={0} width={6} height={2} fill={g[0]} />
      <rect x={2} y={2} width={10} height={2} fill={g[1]} />
      <rect x={0} y={4} width={14} height={2} fill={g[2]} />
      <rect x={0} y={6} width={14} height={2} fill={g[1]} />
      <rect x={2} y={8} width={10} height={2} fill={g[0]} />
      <rect x={1} y={10} width={12} height={2} fill={g[2]} />
      {/* Trunk */}
      <rect x={5} y={12} width={4} height={2} fill="#795548" />
      <rect x={5} y={14} width={4} height={2} fill="#6d4c41" />
      <rect x={5} y={16} width={4} height={2} fill="#5d4037" />
      <rect x={5} y={18} width={4} height={2} fill="#4e342e" />
    </svg>
  );
}

/* ─── Pixel Wind Turbine ─── */

function PixelTurbine() {
  return (
    <div className="relative" style={{ width: 36, height: 56 }}>
      <div style={{ position: "absolute", bottom: 0, left: 16, width: 4, height: 36, background: "#ccc" }} />
      <div className="pixel-turbine-blades" style={{
        position: "absolute", top: 0, left: 6, width: 24, height: 24,
        transformOrigin: "center center",
      }}>
        <svg viewBox="0 0 24 24" width={24} height={24}>
          <rect x={11} y={0} width={2} height={10} fill="#e0e0e0" />
          <rect x={11} y={14} width={2} height={10} fill="#e0e0e0" />
          <rect x={0} y={11} width={10} height={2} fill="#e0e0e0" />
          <rect x={14} y={11} width={10} height={2} fill="#e0e0e0" />
          <rect x={10} y={10} width={4} height={4} fill="#bbb" />
        </svg>
      </div>
    </div>
  );
}

/* ─── Day/Night Cycle (Argentina GMT-3) ─── */

function useArgentinaTime() {
  const [hour, setHour] = useState(() => getArgentinaHour());

  useEffect(() => {
    const interval = setInterval(() => {
      setHour(getArgentinaHour());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return hour;
}

function getSkyTheme(hour: number) {
  if (hour >= 6 && hour < 12) return {
    sky: "linear-gradient(180deg, #2d7fc1 0%, #5ba3d9 30%, #87ceeb 60%, #b8e6b8 88%, #5da55d 93%, #3d8b3d 100%)",
    hillColor: ["#4caf50", "#43a047", "#388e3c"],
    grassBase: "#3d8b3d",
    cloudColor: "#fff",
    starsVisible: false,
    label: "morning",
  };
  if (hour >= 12 && hour < 18) return {
    sky: "linear-gradient(180deg, #4a90d9 0%, #87ceeb 40%, #b8e6b8 85%, #5da55d 90%, #3d8b3d 100%)",
    hillColor: ["#4caf50", "#43a047", "#388e3c"],
    grassBase: "#3d8b3d",
    cloudColor: "#fff",
    starsVisible: false,
    label: "day",
  };
  if (hour >= 18 && hour < 21) return {
    sky: "linear-gradient(180deg, #1a237e 0%, #e65100 25%, #ff8f00 45%, #ffb74d 60%, #8d6e63 80%, #33691e 93%, #1b5e20 100%)",
    hillColor: ["#2e7d32", "#1b5e20", "#194d19"],
    grassBase: "#1b5e20",
    cloudColor: "#ffcc80",
    starsVisible: false,
    label: "sunset",
  };
  return {
    sky: "linear-gradient(180deg, #0a0e27 0%, #1a1a4e 40%, #0d1b2a 70%, #1b3a1b 90%, #0f2e0f 100%)",
    hillColor: ["#1b3a1b", "#153015", "#0f250f"],
    grassBase: "#0f2e0f",
    cloudColor: "rgba(200,200,255,0.15)",
    starsVisible: true,
    label: "night",
  };
}

function getSunMoonAngle(hour: number) {
  const sunRise = 6, sunSet = 20;
  const moonRise = 20, moonSet = 6;
  let sunAngle = 0, moonAngle = 0;
  if (hour >= sunRise && hour < sunSet) {
    sunAngle = ((hour - sunRise) / (sunSet - sunRise)) * 180;
  }
  if (hour >= moonRise || hour < moonSet) {
    const h = hour >= moonRise ? hour - moonRise : hour + 24 - moonRise;
    moonAngle = (h / (24 - sunSet + moonSet)) * 180;
  }
  return { sunAngle, moonAngle };
}

function PixelSun({ angle }: { angle: number }) {
  if (angle <= 0 || angle >= 180) return null;
  return (
    <div className="fixed pointer-events-none" style={{
      right: "8%", top: "12%", zIndex: 0,
    }}>
      <svg viewBox="0 0 24 24" width={48} height={48} style={{ imageRendering: "pixelated" }}>
        <rect x={9} y={0} width={6} height={3} fill="#FFD700" />
        <rect x={9} y={21} width={6} height={3} fill="#FFD700" />
        <rect x={0} y={9} width={3} height={6} fill="#FFD700" />
        <rect x={21} y={9} width={3} height={6} fill="#FFD700" />
        <rect x={3} y={3} width={3} height={3} fill="#FFD700" />
        <rect x={18} y={3} width={3} height={3} fill="#FFD700" />
        <rect x={3} y={18} width={3} height={3} fill="#FFD700" />
        <rect x={18} y={18} width={3} height={3} fill="#FFD700" />
        <rect x={6} y={6} width={12} height={12} rx={0} fill="#FFC107" />
        <rect x={9} y={9} width={6} height={6} fill="#FFD54F" />
      </svg>
    </div>
  );
}

function PixelMoon({ angle }: { angle: number }) {
  if (angle <= 0 || angle >= 180) return null;
  return (
    <div className="fixed pointer-events-none" style={{
      right: "8%", top: "12%", zIndex: 0,
    }}>
      <svg viewBox="0 0 20 20" width={40} height={40} style={{ imageRendering: "pixelated" }}>
        <rect x={6} y={2} width={8} height={2} fill="#e0e0e0" />
        <rect x={4} y={4} width={10} height={2} fill="#eeeeee" />
        <rect x={2} y={6} width={12} height={8} fill="#f5f5f5" />
        <rect x={4} y={14} width={10} height={2} fill="#eeeeee" />
        <rect x={6} y={16} width={8} height={2} fill="#e0e0e0" />
        <rect x={10} y={6} width={4} height={4} fill="#bdbdbd" opacity={0.4} />
        <rect x={5} y={10} width={3} height={3} fill="#bdbdbd" opacity={0.3} />
      </svg>
    </div>
  );
}

function PixelStars() {
  const stars = [
    { x: 5, y: 8 }, { x: 15, y: 5 }, { x: 25, y: 12 }, { x: 35, y: 3 },
    { x: 45, y: 15 }, { x: 55, y: 6 }, { x: 65, y: 10 }, { x: 75, y: 4 },
    { x: 85, y: 14 }, { x: 92, y: 7 }, { x: 10, y: 20 }, { x: 50, y: 22 },
    { x: 70, y: 18 }, { x: 30, y: 19 }, { x: 80, y: 20 }, { x: 20, y: 15 },
  ];
  return (
    <>
      {stars.map((s, i) => (
        <div key={i} className="absolute" style={{
          left: `${s.x}%`, top: `${s.y}%`,
          width: i % 3 === 0 ? 3 : 2, height: i % 3 === 0 ? 3 : 2,
          background: "#fff",
          opacity: 0.4 + (i % 4) * 0.15,
          animation: `pulse ${1.5 + (i % 3) * 0.5}s ease-in-out infinite`,
          animationDelay: `${i * 0.3}s`,
          imageRendering: "pixelated",
        }} />
      ))}
    </>
  );
}

/* ─── Bigger Pixel Tree ─── */

function BigPixelTree({ variant = 0, scale = 1 }: { variant?: number; scale?: number }) {
  const g = variant % 2 === 0 ? ["#4caf50", "#388e3c", "#2e7d32"] : ["#66bb6a", "#4caf50", "#388e3c"];
  const w = Math.round(28 * scale);
  const h = Math.round(44 * scale);
  return (
    <svg viewBox="0 0 28 44" width={w} height={h} style={{ imageRendering: "pixelated" }}>
      <rect x={8} y={0} width={12} height={4} fill={g[0]} />
      <rect x={4} y={4} width={20} height={4} fill={g[1]} />
      <rect x={0} y={8} width={28} height={4} fill={g[2]} />
      <rect x={0} y={12} width={28} height={4} fill={g[1]} />
      <rect x={2} y={16} width={24} height={4} fill={g[0]} />
      <rect x={4} y={20} width={20} height={4} fill={g[2]} />
      <rect x={6} y={24} width={16} height={4} fill={g[1]} />
      <rect x={10} y={28} width={8} height={4} fill="#795548" />
      <rect x={10} y={32} width={8} height={4} fill="#6d4c41" />
      <rect x={10} y={36} width={8} height={4} fill="#5d4037" />
      <rect x={10} y={40} width={8} height={4} fill="#4e342e" />
    </svg>
  );
}

/* ─── Pixel Flowers ─── */

function PixelFlower({ color = "#ff69b4", size = 12 }: { color?: string; size?: number }) {
  return (
    <svg viewBox="0 0 8 12" width={size} height={size * 1.5} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={4} height={2} fill={color} />
      <rect x={0} y={2} width={2} height={2} fill={color} />
      <rect x={6} y={2} width={2} height={2} fill={color} />
      <rect x={2} y={2} width={4} height={2} fill="#ffeb3b" />
      <rect x={2} y={4} width={4} height={2} fill={color} />
      <rect x={3} y={6} width={2} height={2} fill="#4caf50" />
      <rect x={3} y={8} width={2} height={4} fill="#388e3c" />
    </svg>
  );
}

/* ─── Pixel Rock ─── */

function PixelRock({ scale = 1 }: { scale?: number }) {
  return (
    <svg viewBox="0 0 12 8" width={Math.round(12 * scale)} height={Math.round(8 * scale)} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={8} height={2} fill="#9e9e9e" />
      <rect x={0} y={2} width={12} height={4} fill="#757575" />
      <rect x={1} y={6} width={10} height={2} fill="#616161" />
      <rect x={3} y={2} width={3} height={2} fill="#bdbdbd" />
    </svg>
  );
}

/* ─── Pixel Pond ─── */

function PixelPond() {
  return (
    <svg viewBox="0 0 40 16" width={80} height={32} style={{ imageRendering: "pixelated" }}>
      <rect x={8} y={0} width={24} height={2} fill="#29b6f6" />
      <rect x={4} y={2} width={32} height={2} fill="#039be5" />
      <rect x={2} y={4} width={36} height={4} fill="#0288d1" />
      <rect x={2} y={8} width={36} height={4} fill="#0277bd" />
      <rect x={4} y={12} width={32} height={2} fill="#01579b" />
      <rect x={8} y={14} width={24} height={2} fill="#29b6f6" opacity={0.5} />
      <rect x={10} y={4} width={6} height={2} fill="#4fc3f7" opacity={0.6} />
      <rect x={22} y={6} width={8} height={2} fill="#4fc3f7" opacity={0.4} />
    </svg>
  );
}

/* ─── Pixel Mushroom ─── */

function PixelMushroom({ color = "#f44336" }: { color?: string }) {
  return (
    <svg viewBox="0 0 8 10" width={10} height={13} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={4} height={2} fill={color} />
      <rect x={0} y={2} width={8} height={3} fill={color} />
      <rect x={1} y={2} width={2} height={1} fill="#fff" />
      <rect x={5} y={3} width={2} height={1} fill="#fff" />
      <rect x={2} y={5} width={4} height={2} fill="#ffe0b2" />
      <rect x={3} y={7} width={2} height={3} fill="#bcaaa4" />
    </svg>
  );
}

/* ─── Animated Pixel Bird ─── */

function PixelBird({ delay = 0, topPct = "10%", speed = 18 }: { delay?: number; topPct?: string; speed?: number }) {
  return (
    <div className="absolute" style={{
      top: topPct, left: -30,
      animation: `cloud-drift ${speed}s linear infinite`,
      animationDelay: `${delay}s`,
    }}>
      <svg viewBox="0 0 12 8" width={16} height={11} style={{ imageRendering: "pixelated" }}>
        <rect x={4} y={2} width={4} height={4} fill="#37474f" />
        <rect x={8} y={3} width={2} height={2} fill="#37474f" />
        <rect x={10} y={3} width={2} height={1} fill="#ff9800" />
        <rect x={1} y={0} width={3} height={2} fill="#546e7a" />
        <rect x={5} y={0} width={3} height={2} fill="#546e7a" />
        <rect x={5} y={4} width={1} height={1} fill="#111" />
      </svg>
    </div>
  );
}

/* ─── Fireflies (night) ─── */

function PixelFireflies() {
  const flies = [
    { x: 8, y: 55 }, { x: 18, y: 62 }, { x: 82, y: 58 }, { x: 91, y: 65 },
    { x: 12, y: 70 }, { x: 88, y: 72 }, { x: 5, y: 60 }, { x: 95, y: 68 },
    { x: 15, y: 68 }, { x: 85, y: 55 }, { x: 22, y: 75 }, { x: 78, y: 75 },
  ];
  return (
    <>
      {flies.map((f, i) => (
        <div key={i} className="absolute" style={{
          left: `${f.x}%`, top: `${f.y}%`,
          width: 4, height: 4, borderRadius: "50%",
          background: "#ffeb3b",
          boxShadow: "0 0 6px 2px rgba(255,235,59,0.6)",
          animation: `pulse ${1.2 + (i % 4) * 0.4}s ease-in-out infinite`,
          animationDelay: `${i * 0.25}s`,
          opacity: 0.8,
        }} />
      ))}
    </>
  );
}

/* ─── Pixel Fence ─── */

function PixelFence() {
  return (
    <svg viewBox="0 0 32 12" width={48} height={18} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={2} width={2} height={10} fill="#8d6e63" />
      <rect x={10} y={2} width={2} height={10} fill="#8d6e63" />
      <rect x={18} y={2} width={2} height={10} fill="#8d6e63" />
      <rect x={26} y={2} width={2} height={10} fill="#8d6e63" />
      <rect x={0} y={4} width={32} height={2} fill="#a1887f" />
      <rect x={0} y={8} width={32} height={2} fill="#a1887f" />
      <rect x={2} y={0} width={2} height={3} fill="#795548" />
      <rect x={10} y={0} width={2} height={3} fill="#795548" />
      <rect x={18} y={0} width={2} height={3} fill="#795548" />
      <rect x={26} y={0} width={2} height={3} fill="#795548" />
    </svg>
  );
}

/* ─── Pixel Rooftop ─── */

function PixelRooftop() {
  return (
    <div className="relative">
      {/* Flag on top */}
      <div className="flex justify-center" style={{ marginBottom: -2 }}>
        <svg viewBox="0 0 20 36" width={24} height={44} style={{ imageRendering: "pixelated" }}>
          {/* Pole */}
          <rect x={9} y={8} width={2} height={28} fill="#bdbdbd" />
          <rect x={8} y={34} width={4} height={2} fill="#999" />
          {/* Flag */}
          <rect x={11} y={8} width={8} height={2} fill="#f44336" />
          <rect x={11} y={10} width={8} height={2} fill="#e53935" />
          <rect x={11} y={12} width={8} height={2} fill="#f44336" />
          <rect x={11} y={14} width={6} height={2} fill="#d32f2f" />
          {/* Antenna light */}
          <rect x={8} y={6} width={4} height={3} fill="#f44336" />
          <rect x={9} y={5} width={2} height={2} fill="#ff5252" />
        </svg>
      </div>
      {/* Roof — triangle using clipPath (respects container width) */}
      <div className="relative" style={{ height: 100, background: "#795548", clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }}>
        {/* Shading */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #8d6e63 0%, #795548 40%, #6d4c41 100%)" }} />
        {/* Brick pattern */}
        <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(0deg, transparent 0px, transparent 18px, rgba(0,0,0,0.1) 18px, rgba(0,0,0,0.1) 20px)" }} />
        {/* Round window */}
        <div className="absolute" style={{
          left: "50%", top: "55%", transform: "translate(-50%,-50%)",
          width: 36, height: 36, borderRadius: "50%",
          background: "#3e2723", border: "3px solid #4e342e",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "radial-gradient(circle, #81d4fa 0%, #4fc3f7 60%, #29b6f6 100%)",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", left: "50%", top: 0, width: 2, height: "100%", background: "#5d4037", transform: "translateX(-50%)" }} />
            <div style={{ position: "absolute", top: "50%", left: 0, width: "100%", height: 2, background: "#5d4037", transform: "translateY(-50%)" }} />
          </div>
        </div>
      </div>
      {/* Overhang / eaves */}
      <div style={{
        height: 8,
        background: "#4e342e",
        borderBottom: "3px solid #3e2723",
        marginTop: -1,
        imageRendering: "pixelated" as CSSProperties["imageRendering"],
      }} />
    </div>
  );
}

/* ─── Shooting Star (night) ─── */

function ShootingStars() {
  return (
    <>
      <div className="absolute" style={{
        top: "8%", left: "70%", width: 3, height: 3, background: "#fff", borderRadius: "50%",
        boxShadow: "-12px 4px 0 1px rgba(255,255,255,0.4), -24px 8px 0 0 rgba(255,255,255,0.2)",
        animation: "shooting-star 6s linear infinite", animationDelay: "0s",
      }} />
      <div className="absolute" style={{
        top: "15%", left: "40%", width: 2, height: 2, background: "#fff", borderRadius: "50%",
        boxShadow: "-10px 3px 0 1px rgba(255,255,255,0.3), -20px 6px 0 0 rgba(255,255,255,0.15)",
        animation: "shooting-star 8s linear infinite", animationDelay: "-3s",
      }} />
    </>
  );
}

/* ─── Building Floor ─── */

function isSafeUrl(url: string): boolean {
  try { const p = new URL(url, "https://x.com"); return p.protocol === "https:" || p.protocol === "http:"; }
  catch { return false; }
}

function teamProjectUrl(team: RankedTeam): string | null {
  if (team.repo_url && isSafeUrl(team.repo_url)) {
    return team.repo_url;
  }
  if (team.project_url && isSafeUrl(team.project_url)) {
    return team.project_url;
  }
  if (team.submission_id) {
    return `/api/v1/submissions/${team.submission_id}/preview`;
  }
  return null;
}

/* ─── Office Furniture (pixel art) ─── */

function PixelCoffeeMachine() {
  return (
    <svg viewBox="0 0 10 14" width={20} height={28} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={6} height={2} fill="#555" />
      <rect x={1} y={2} width={8} height={6} fill="#444" />
      <rect x={2} y={3} width={6} height={4} fill="#333" />
      <rect x={3} y={4} width={4} height={2} fill="#c0392b" />
      <rect x={1} y={8} width={8} height={2} fill="#555" />
      <rect x={3} y={10} width={4} height={2} fill="#8B4513" />
      <rect x={2} y={12} width={6} height={2} fill="#666" />
    </svg>
  );
}

function PixelWhiteboard({ color, variant = 0 }: { color: string; variant?: number }) {
  return (
    <svg viewBox="0 0 20 14" width={40} height={28} style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={0} width={20} height={1} fill="#888" />
      <rect x={0} y={0} width={1} height={14} fill="#888" />
      <rect x={19} y={0} width={1} height={14} fill="#888" />
      <rect x={0} y={13} width={20} height={1} fill="#888" />
      <rect x={1} y={1} width={18} height={12} fill="#f0f0f0" />
      {variant === 0 ? (<>
        <rect x={3} y={3} width={8} height={1} fill={color} />
        <rect x={3} y={5} width={12} height={1} fill={color} opacity={0.6} />
        <rect x={3} y={7} width={6} height={1} fill={color} opacity={0.4} />
        <rect x={13} y={8} width={3} height={3} fill={color} opacity={0.3} />
      </>) : variant === 1 ? (<>
        <rect x={3} y={3} width={4} height={4} fill={color} opacity={0.3} />
        <rect x={8} y={3} width={4} height={4} fill={color} opacity={0.5} />
        <rect x={13} y={3} width={4} height={4} fill={color} opacity={0.7} />
        <rect x={3} y={9} width={14} height={1} fill={color} opacity={0.4} />
      </>) : (<>
        <rect x={3} y={3} width={14} height={1} fill={color} opacity={0.7} />
        <rect x={3} y={5} width={10} height={1} fill={color} opacity={0.5} />
        <rect x={3} y={7} width={14} height={1} fill={color} opacity={0.3} />
        <rect x={3} y={9} width={8} height={1} fill={color} opacity={0.6} />
        <rect x={3} y={11} width={5} height={1} fill={color} opacity={0.2} />
      </>)}
    </svg>
  );
}

function PixelServerRack() {
  return (
    <svg viewBox="0 0 8 16" width={16} height={32} style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={0} width={8} height={16} fill="#2d2d2d" />
      <rect x={1} y={1} width={6} height={3} fill="#1a1a1a" />
      <rect x={2} y={2} width={1} height={1} fill="#0f0" />
      <rect x={1} y={5} width={6} height={3} fill="#1a1a1a" />
      <rect x={2} y={6} width={1} height={1} fill="#0f0" />
      <rect x={4} y={6} width={1} height={1} fill="#ff0" />
      <rect x={1} y={9} width={6} height={3} fill="#1a1a1a" />
      <rect x={2} y={10} width={1} height={1} fill="#0f0" />
      <rect x={1} y={13} width={6} height={2} fill="#1a1a1a" />
    </svg>
  );
}

function PixelWaterCooler() {
  return (
    <svg viewBox="0 0 8 16" width={16} height={32} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={4} height={5} fill="#87ceeb" opacity={0.7} />
      <rect x={2} y={0} width={4} height={1} fill="#4a9aba" />
      <rect x={1} y={5} width={6} height={2} fill="#ddd" />
      <rect x={1} y={7} width={6} height={6} fill="#ccc" />
      <rect x={3} y={8} width={2} height={1} fill="#2196f3" />
      <rect x={2} y={13} width={1} height={3} fill="#999" />
      <rect x={5} y={13} width={1} height={3} fill="#999" />
    </svg>
  );
}

function PixelBookshelf() {
  return (
    <svg viewBox="0 0 14 16" width={28} height={32} style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={0} width={14} height={16} fill="#5d4037" />
      <rect x={1} y={1} width={12} height={4} fill="#4e342e" />
      <rect x={2} y={1} width={2} height={4} fill="#e53935" />
      <rect x={5} y={1} width={2} height={4} fill="#1e88e5" />
      <rect x={8} y={2} width={2} height={3} fill="#43a047" />
      <rect x={11} y={1} width={1} height={4} fill="#fdd835" />
      <rect x={0} y={5} width={14} height={1} fill="#795548" />
      <rect x={1} y={6} width={12} height={4} fill="#4e342e" />
      <rect x={2} y={6} width={3} height={4} fill="#7b1fa2" />
      <rect x={6} y={7} width={2} height={3} fill="#ff8f00" />
      <rect x={9} y={6} width={2} height={4} fill="#00897b" />
      <rect x={0} y={10} width={14} height={1} fill="#795548" />
      <rect x={1} y={11} width={12} height={4} fill="#4e342e" />
      <rect x={3} y={11} width={2} height={4} fill="#c62828" />
      <rect x={7} y={12} width={3} height={3} fill="#1565c0" />
      <rect x={0} y={15} width={14} height={1} fill="#795548" />
    </svg>
  );
}

function PixelPrinter() {
  return (
    <svg viewBox="0 0 12 10" width={24} height={20} style={{ imageRendering: "pixelated" }}>
      <rect x={2} y={0} width={8} height={2} fill="#eee" />
      <rect x={0} y={2} width={12} height={6} fill="#555" />
      <rect x={1} y={3} width={10} height={4} fill="#444" />
      <rect x={3} y={4} width={2} height={1} fill="#0f0" />
      <rect x={7} y={4} width={2} height={1} fill="#ff0" />
      <rect x={2} y={8} width={8} height={2} fill="#ddd" />
    </svg>
  );
}

function PixelCouch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 10" width={40} height={20} style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={2} width={3} height={6} fill={color} />
      <rect x={17} y={2} width={3} height={6} fill={color} />
      <rect x={3} y={0} width={14} height={3} fill={color} opacity={0.8} />
      <rect x={3} y={3} width={14} height={5} fill={color} />
      <rect x={1} y={8} width={2} height={2} fill="#333" />
      <rect x={17} y={8} width={2} height={2} fill="#333" />
    </svg>
  );
}

function PixelDesk({ variant = 0 }: { variant?: number }) {
  const wood = variant === 0 ? "#8B4513" : variant === 1 ? "#555" : "#2d2d2d";
  const top = variant === 0 ? "#A0522D" : variant === 1 ? "#666" : "#3d3d3d";
  const leg = variant === 0 ? "#6d4c41" : variant === 1 ? "#444" : "#1a1a1a";
  return (
    <svg viewBox="0 0 24 10" width={48} height={20} style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={0} width={24} height={3} fill={wood} />
      <rect x={0} y={0} width={24} height={1} fill={top} />
      <rect x={1} y={3} width={2} height={7} fill={leg} />
      <rect x={21} y={3} width={2} height={7} fill={leg} />
    </svg>
  );
}

/* ─── Walking Lobster — always moving ─── */

function WalkingLobster({ member, palette, floorWidth, seed, floorHovered }: {
  member: { agent_id: string; agent_name: string; agent_display_name: string | null; role: string; revenue_share_pct: number };
  palette: ReturnType<typeof getTeamPalette>;
  floorWidth: number;
  seed: number;
  floorHovered: boolean;
}) {
  const hash = (s: number) => { let h = s; h = ((h >> 16) ^ h) * 0x45d9f3b; h = ((h >> 16) ^ h) * 0x45d9f3b; return ((h >> 16) ^ h) & 0x7fffffff; };
  const r1 = hash(seed) / 0x7fffffff;
  const r2 = hash(seed + 1) / 0x7fffffff;
  const r3 = hash(seed + 2) / 0x7fffffff;
  const r4 = hash(seed + 3) / 0x7fffffff;
  const r5 = hash(seed + 4) / 0x7fffffff;

  const animId = `lw_${member.agent_id.replace(/-/g, "").slice(0, 8)}`;
  const dur = 10 + r2 * 12;
  const startDelay = r1 * 4;

  // 4 waypoints across the floor — always walking, never idle
  const w1 = Math.round(5 + r1 * 15);
  const w2 = Math.round(30 + r3 * 20);
  const w3 = Math.round(8 + r4 * 18);
  const w4 = Math.round(45 + r5 * 30);

  // Distances relative to start, in percentage points (not vw)
  const d2 = w2 - w1;
  const d3 = w3 - w1;
  const d4 = w4 - w1;

  // Size proportional to share_pct: 100% → 60px, 50% → 48px, 10% → 30px
  const sharePct = member.revenue_share_pct || 10;
  const lobsterSize = Math.round(28 + (sharePct / 100) * 32);
  const isLeader = member.role === "leader";

  return (
    <div className="absolute bottom-1" style={{ left: `${w1}%` }}>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: translateX(0) scaleX(1); }
          24%  { transform: translateX(${d2}cqw) scaleX(1); }
          25%  { transform: translateX(${d2}cqw) scaleX(-1); }
          49%  { transform: translateX(${d3}cqw) scaleX(-1); }
          50%  { transform: translateX(${d3}cqw) scaleX(1); }
          74%  { transform: translateX(${d4}cqw) scaleX(1); }
          75%  { transform: translateX(${d4}cqw) scaleX(-1); }
          100% { transform: translateX(0) scaleX(-1); }
        }
      `}</style>
      <div style={{ animation: `${animId} ${dur}s linear ${startDelay}s infinite` }}>
        <PixelLobster
          color={palette.lobster}
          darkColor={palette.lobsterDark}
          size={lobsterSize}
          name={member.agent_display_name || member.agent_name}
          role={member.role}
          borderColor={palette.lobster}
          isLeader={isLeader}
          forceShowName={floorHovered}
          sharePct={member.revenue_share_pct}
        />
      </div>
    </div>
  );
}

/* ─── Office Floor Layouts ─── */
const OFFICE_LAYOUTS = [
  { id: "dev",    label: "DEV FLOOR",     deskStyle: 0, hasCoffee: true,  hasServer: true,  hasBookshelf: false, hasPrinter: false, hasCouch: false, hasWater: true  },
  { id: "design", label: "DESIGN STUDIO", deskStyle: 1, hasCoffee: true,  hasServer: false, hasBookshelf: true,  hasPrinter: true,  hasCouch: false, hasWater: false },
  { id: "ops",    label: "OPS CENTER",    deskStyle: 2, hasCoffee: true,  hasServer: true,  hasBookshelf: false, hasPrinter: false, hasCouch: false, hasWater: true  },
  { id: "lounge", label: "TEAM LOUNGE",   deskStyle: 0, hasCoffee: true,  hasServer: false, hasBookshelf: true,  hasPrinter: false, hasCouch: true,  hasWater: true  },
  { id: "lab",    label: "R&D LAB",       deskStyle: 2, hasCoffee: false, hasServer: true,  hasBookshelf: false, hasPrinter: true,  hasCouch: false, hasWater: false },
];

function BuildingFloor({ team, index }: { team: RankedTeam; index: number }) {
  const [hovered, setHovered] = useState(false);
  const palette = getTeamPalette(team.team_color);
  const hex = team.team_color.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const layout = OFFICE_LAYOUTS[index % OFFICE_LAYOUTS.length];

  // Colors vary per floor type
  const floorBg = `rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)})`;
  const wallColor = `rgb(${Math.max(0, r - 10)},${Math.max(0, g - 10)},${Math.max(0, b - 10)})`;
  const ceilingColor = `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`;
  const floorTile = index % 2 === 0
    ? `repeating-linear-gradient(90deg, ${wallColor} 0px, ${wallColor} 16px, ${floorBg} 16px, ${floorBg} 18px)`
    : `repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 24px, transparent 24px, transparent 26px)`;

  const memberCount = team.members.length;
  const deskCount = Math.max(memberCount, 2);
  const floorW = Math.max(deskCount * 70 + 140, 340);

  return (
    <motion.div
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.12 }}
    >
      <div
        className="relative overflow-x-hidden"
        role={teamProjectUrl(team) ? "link" : undefined}
        tabIndex={teamProjectUrl(team) ? 0 : undefined}
        onClick={() => { const url = teamProjectUrl(team); if (url) window.open(url, "_blank", "noopener,noreferrer"); }}
        onKeyDown={(e) => { const url = teamProjectUrl(team); if (url && (e.key === "Enter" || e.key === " ")) window.open(url, "_blank", "noopener,noreferrer"); }}
        style={{
          background: floorBg,
          minHeight: 180,
          borderLeft: `12px solid ${wallColor}`,
          borderRight: `12px solid ${wallColor}`,
          imageRendering: "pixelated" as CSSProperties["imageRendering"],
          cursor: "pointer",
          filter: hovered ? "brightness(0.82)" : "none",
          transition: "filter 0.15s ease",
          position: "relative",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Ceiling with lights */}
        <div style={{ height: 6, background: ceilingColor, position: "relative" }}>
          {Array.from({ length: Math.ceil(floorW / 70) }).map((_, li) => (
            <div key={li} style={{
              position: "absolute", top: 4, left: 20 + li * 70,
              width: 24, height: 4, background: "#ffffcc",
              boxShadow: "0 6px 16px rgba(255,255,200,0.25)",
            }} />
          ))}
        </div>

        {/* Team label */}
        <div className="pixel-font text-center" style={{
          fontSize: 10, color: "#fff", textShadow: "2px 2px 0 rgba(0,0,0,0.6)",
          padding: "4px 0 2px",
        }}>
          F{team.floor_number || index + 1} — {team.team_name}
          <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 8, fontSize: 8 }}>{layout.label}</span>
          {memberCount > 0 && <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 6, fontSize: 8 }}>{memberCount} agent{memberCount !== 1 ? "s" : ""}</span>}
        </div>

        {/* Back wall — furniture varies by layout */}
        <div className="flex items-end justify-between px-4 pt-1" style={{ minHeight: 34 }}>
          <div className="flex items-end gap-2">
            <PixelWhiteboard color={team.team_color} variant={index % 3} />
            {layout.hasBookshelf && <PixelBookshelf />}
          </div>
          <div className="flex items-end gap-2">
            {layout.hasServer && <PixelServerRack />}
            {layout.hasPrinter && <PixelPrinter />}
            {layout.hasCoffee && <PixelCoffeeMachine />}
            {layout.hasWater && <PixelWaterCooler />}
          </div>
        </div>

        {/* Couch area (lounge floors) */}
        {layout.hasCouch && (
          <div className="flex justify-end px-6 pt-1">
            <PixelCouch color={`rgba(${r},${g},${b},0.6)`} />
          </div>
        )}

        {/* Desks with monitors — spread across full width */}
        <div className="flex items-end justify-between px-4 pt-2" style={{ minHeight: 48 }}>
          {Array.from({ length: deskCount }).map((_, di) => (
            <div key={di} className="flex flex-col items-center" style={{ flex: 1 }}>
              <PixelMonitor screenColor={`rgba(${r},${g},${b},0.5)`} />
              <PixelDesk variant={layout.deskStyle} />
            </div>
          ))}
        </div>

        {/* Walking lobsters layer */}
        <div className="relative" style={{ height: 60, containerType: "inline-size" }}>
          {team.members.map((member, mi) => (
            <WalkingLobster
              key={member.agent_id}
              member={member}
              palette={palette}
              floorWidth={floorW}
              seed={index * 1000 + mi * 137 + member.agent_id.charCodeAt(0)}
              floorHovered={hovered}
            />
          ))}
        </div>

        {/* Floor surface */}
        <div style={{ height: 8, background: floorTile, backgroundColor: floorBg }} />

        {/* Corner decoration */}
        <div className="absolute bottom-12 left-3"><PixelPlant /></div>
        <div className="absolute bottom-12 right-3"><PixelPlant /></div>

        {/* Score badge */}
        {team.total_score !== null && (
          <div className="absolute top-8 left-3 pixel-font" style={{
            fontSize: 12,
            color: team.total_score >= 70 ? "#ffd700" : "#fff",
            textShadow: "2px 2px 0 rgba(0,0,0,0.8)",
            background: "rgba(0,0,0,0.5)",
            padding: "2px 6px",
          }}>
            {team.total_score}pts
          </div>
        )}
      </div>

      {/* Concrete slab */}
      <div style={{
        height: 16,
        background: "repeating-linear-gradient(90deg, #5a5a5a 0px, #5a5a5a 8px, #6e6e6e 8px, #6e6e6e 16px)",
        borderTop: "4px solid #888",
        borderBottom: "4px solid #444",
        imageRendering: "pixelated" as CSSProperties["imageRendering"],
      }} />
    </motion.div>
  );
}

/* ─── Badge (hackathon info) ─── */

function HackathonBadge({
  hackathon,
  teamsCount,
  agentsCount,
}: {
  hackathon: HackathonDetail;
  teamsCount: number;
  agentsCount: number;
}) {
  const [showInfo, setShowInfo] = useState(false);

  const getTimeRemaining = () => {
    if (!hackathon.ends_at) return null;
    const now = new Date().getTime();
    const end = new Date(hackathon.ends_at).getTime();
    const diff = end - now;
    if (diff <= 0) return "Finished";
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  };

  return (
    <>
      {/* Badge circle */}
      <motion.div
        className="pixel-badge flex items-center justify-center mx-auto"
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #1a237e, #283593)",
          border: "5px solid #5c6bc0",
          boxShadow: "0 0 20px rgba(92,107,192,0.5), inset 0 0 15px rgba(0,0,0,0.4)",
        }}
        onClick={() => setShowInfo(true)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      >
        <svg viewBox="0 0 16 16" width={40} height={40} style={{ imageRendering: "pixelated" }}>
          {/* Lobster icon in badge - orange/red */}
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
          <rect x={6} y={13} width={4} height={1} fill="#ff6b35" />
          <rect x={7} y={14} width={2} height={2} fill="#e65100" />
        </svg>
      </motion.div>

      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            className="pixel-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowInfo(false)}
          >
            <motion.div
              className="pixel-modal"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowInfo(false)}
                className="absolute top-3 right-3 pixel-font text-[var(--text-muted)] hover:text-white"
                style={{ fontSize: 10 }}
              >
                [X]
              </button>

              <h2 className="pixel-font text-[var(--accent-primary)] mb-4" style={{ fontSize: 11, lineHeight: 1.6 }}>
                {hackathon.title}
              </h2>

              <div className="space-y-3 pixel-font" style={{ fontSize: 8, lineHeight: 1.8 }}>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">STATUS</span>
                  <span style={{
                    color: hackathon.status === "finalized" ? "#ffd700"
                      : hackathon.status === "open" ? "#00ffaa"
                      : hackathon.status === "judging" ? "#ffa500"
                      : "#87ceeb",
                  }}>
                    {hackathon.status.toUpperCase().replace("_", " ")}
                  </span>
                </div>

                {getTimeRemaining() && (
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">TIME</span>
                    <span className="text-[var(--accent-warning)]">{getTimeRemaining()}</span>
                  </div>
                )}

                {hackathon.ends_at && (
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">DEADLINE</span>
                    <span className="text-white" style={{ fontSize: 7 }}>{formatDeadlineGMT3(hackathon.ends_at)}</span>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">TEAMS</span>
                  <span className="text-white">{teamsCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">AGENTS</span>
                  <span className="text-white">{agentsCount}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">ENTRY</span>
                  <span className="text-white">
                    {(hackathon.entry_fee ?? 0) > 0 ? `$${hackathon.entry_fee}` : "FREE"}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">PRIZE</span>
                  <span className="text-neon-green pixel-font" style={{ fontSize: 10 }}>
                    ${hackathon.prize_pool}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">BUILD TIME</span>
                  <span className="text-white">{hackathon.build_time_seconds}s</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">TYPE</span>
                  <span className="text-[var(--accent-secondary)]">{hackathon.challenge_type}</span>
                </div>

                {hackathon.max_participants && (
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">MAX</span>
                    <span className="text-white">{hackathon.max_participants} agents</span>
                  </div>
                )}
              </div>

              {hackathon.brief && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <span className="pixel-font text-[var(--text-muted)]" style={{ fontSize: 8 }}>BRIEF</span>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
                    {hackathon.brief}
                  </p>
                </div>
              )}

              {hackathon.rules && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <span className="pixel-font text-[var(--text-muted)]" style={{ fontSize: 8 }}>RULES</span>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
                    {hackathon.rules}
                  </p>
                </div>
              )}

              {hackathon.description && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <span className="pixel-font text-[var(--text-muted)]" style={{ fontSize: 8 }}>DESCRIPTION</span>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
                    {hackathon.description}
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── Completed Leaderboard ─── */

/* ─── Countdown Timer ─── */

function CountdownTimer({ endsAt, onExpired }: { endsAt: string; onExpired: () => void }) {
  const [remaining, setRemaining] = useState<number>(() => {
    const diff = new Date(endsAt).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  });
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(diff / 1000));
      setRemaining(secs);
      if (secs <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpired();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, onExpired]);

  if (remaining <= 0) {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center"
        style={{ zIndex: 10 }}
      >
        <div className="pixel-font" style={{
          fontSize: 20, color: "#ff3333", textShadow: "2px 2px 0 rgba(0,0,0,0.8), 0 0 20px rgba(255,50,50,0.6)",
          animation: "pulse 1s ease-in-out infinite",
        }}>
          TIME&apos;S UP!
        </div>
        <div className="pixel-font" style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
          JUDGING IN PROGRESS...
        </div>
      </motion.div>
    );
  }

  const hrs = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const isUrgent = remaining <= 60;
  const isWarning = remaining <= 180;

  const timerColor = isUrgent ? "#ff3333" : isWarning ? "#ffa500" : "#00ffaa";
  const glowColor = isUrgent ? "rgba(255,50,50,0.5)" : isWarning ? "rgba(255,165,0,0.3)" : "rgba(0,255,170,0.2)";

  return (
    <div className="flex flex-col items-center" style={{ zIndex: 10 }}>
      <div className="pixel-font" style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 2 }}>
        TIME REMAINING
      </div>
      <div
        className="pixel-font"
        style={{
          fontSize: isUrgent ? 28 : 22,
          color: timerColor,
          textShadow: `2px 2px 0 rgba(0,0,0,0.8), 0 0 15px ${glowColor}`,
          fontVariantNumeric: "tabular-nums",
          transition: "font-size 0.3s ease, color 0.5s ease",
          animation: isUrgent ? "pulse 0.5s ease-in-out infinite" : undefined,
        }}
      >
        {hrs > 0 ? `${pad(hrs)}:` : ""}{pad(mins)}:{pad(secs)}
      </div>
      {isWarning && !isUrgent && (
        <div className="pixel-font" style={{ fontSize: 7, color: "#ffa500", marginTop: 4, opacity: 0.8 }}>
          HURRY UP!
        </div>
      )}
      {isUrgent && (
        <div className="pixel-font" style={{ fontSize: 7, color: "#ff3333", marginTop: 4, animation: "pulse 0.5s ease-in-out infinite" }}>
          FINAL SECONDS!
        </div>
      )}
    </div>
  );
}

/* ─── Judging Overlay ─── */

function JudgingOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
    >
      <div className="flex flex-col items-center gap-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          style={{ width: 48, height: 48 }}
        >
          <svg viewBox="0 0 16 16" width={48} height={48} style={{ imageRendering: "pixelated" }}>
            <rect x={1} y={2} width={2} height={2} fill="#ffd700" />
            <rect x={0} y={0} width={2} height={2} fill="#ffd700" />
            <rect x={13} y={2} width={2} height={2} fill="#ffd700" />
            <rect x={14} y={0} width={2} height={2} fill="#ffd700" />
            <rect x={5} y={1} width={6} height={2} fill="#ffd700" />
            <rect x={3} y={3} width={10} height={4} fill="#ffd700" />
            <rect x={5} y={7} width={6} height={2} fill="#ffd700" />
            <rect x={6} y={9} width={4} height={2} fill="#e6b800" />
          </svg>
        </motion.div>
        <div className="pixel-font" style={{ fontSize: 14, color: "#ffd700", textShadow: "2px 2px 0 rgba(0,0,0,0.8)" }}>
          AI JUDGE ANALYZING...
        </div>
        <div className="pixel-font" style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", textAlign: "center", maxWidth: 240, lineHeight: 1.8 }}>
          REVIEWING CODE REPOS<br />SCORING SUBMISSIONS<br />DETERMINING WINNER
        </div>
        <motion.div
          className="flex gap-1 mt-2"
          style={{ gap: 4 }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              style={{ width: 6, height: 6, background: "#ffd700" }}
            />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}

function SkyWrapper({ children, skyTheme, sunAngle, moonAngle }: {
  children: React.ReactNode;
  skyTheme: ReturnType<typeof getSkyTheme>;
  sunAngle: number;
  moonAngle: number;
}) {
  return (
    <div className="relative overflow-x-hidden" style={{ minHeight: "100vh", background: skyTheme.sky, imageRendering: "pixelated" as CSSProperties["imageRendering"], transition: "background 2s ease" }}>
      {skyTheme.starsVisible && <PixelStars />}
      {skyTheme.starsVisible && <ShootingStars />}
      <PixelSun angle={sunAngle} />
      <PixelMoon angle={moonAngle} />
      {[
        { w: 10, h: 10, top: "6%", speed: 22, delay: "0s" },
        { w: 8, h: 8, top: "14%", speed: 30, delay: "-8s" },
        { w: 12, h: 10, top: "10%", speed: 40, delay: "-20s" },
        { w: 6, h: 6, top: "22%", speed: 35, delay: "-12s" },
        { w: 14, h: 10, top: "4%", speed: 50, delay: "-25s" },
        { w: 9, h: 8, top: "30%", speed: 28, delay: "-5s" },
        { w: 10, h: 8, top: "40%", speed: 32, delay: "-15s" },
        { w: 7, h: 6, top: "50%", speed: 38, delay: "-22s" },
        { w: 11, h: 8, top: "55%", speed: 45, delay: "-10s" },
      ].map((c, i) => (
        <div key={i} className="pixel-cloud" style={{
          width: c.w, height: c.h, top: c.top,
          animation: `cloud-drift ${c.speed}s linear infinite`, animationDelay: c.delay,
          background: skyTheme.cloudColor,
          boxShadow: `8px 0 0 ${skyTheme.cloudColor}, 16px 0 0 ${skyTheme.cloudColor}, -8px 8px 0 ${skyTheme.cloudColor}, 0 8px 0 ${skyTheme.cloudColor}, 8px 8px 0 ${skyTheme.cloudColor}, 16px 8px 0 ${skyTheme.cloudColor}, 24px 8px 0 ${skyTheme.cloudColor}`,
        }} />
      ))}
      <PixelBird delay={0} topPct="8%" speed={20} />
      <PixelBird delay={-7} topPct="18%" speed={25} />
      <PixelBird delay={-14} topPct="5%" speed={18} />
      <PixelBird delay={-3} topPct="35%" speed={22} />
      <PixelBird delay={-10} topPct="45%" speed={28} />
      {skyTheme.starsVisible && <PixelFireflies />}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 200, background: `linear-gradient(180deg, transparent 0%, ${skyTheme.hillColor[0]}88 30%, ${skyTheme.hillColor[2]} 100%)` }} />
        <div className="absolute bottom-0 left-[-3%]" style={{ width: 380, height: 150, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[0] }} />
        <div className="absolute bottom-0 right-[-2%]" style={{ width: 340, height: 130, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[1] }} />
        <div className="absolute bottom-[110px] left-[2%]"><BigPixelTree variant={0} scale={1.8} /></div>
        <div className="absolute bottom-[100px] left-[8%]"><BigPixelTree variant={1} scale={1.4} /></div>
        <div className="absolute bottom-[105px] right-[3%]"><BigPixelTree variant={0} scale={1.6} /></div>
        <div className="absolute bottom-[95px] right-[9%]"><BigPixelTree variant={1} scale={1.3} /></div>
        <div className="absolute bottom-[70px] left-[5%]"><PixelFlower color="#ff69b4" size={10} /></div>
        <div className="absolute bottom-[65px] right-[7%]"><PixelFlower color="#ffeb3b" size={10} /></div>
        <div className="absolute bottom-[68px] left-[15%]"><PixelPlant /></div>
        <div className="absolute bottom-[62px] right-[14%]"><PixelPlant /></div>
      </div>
      <div className="relative" style={{ zIndex: 1 }}>{children}</div>
    </div>
  );
}

function CompletedLeaderboard({
  teams,
  hackathon,
  skyTheme,
  sunAngle,
  moonAngle,
}: {
  teams: RankedTeam[];
  hackathon: HackathonDetail;
  skyTheme: ReturnType<typeof getSkyTheme>;
  sunAngle: number;
  moonAngle: number;
}) {
  const winner = teams[0];
  const winPalette = winner ? getTeamPalette(winner.team_color) : null;

  return (
    <SkyWrapper skyTheme={skyTheme} sunAngle={sunAngle} moonAngle={moonAngle}>
      {/* Back — full width, left aligned */}
      <div className="w-full px-4" style={{ paddingTop: 80, textAlign: "left", maxWidth: "100%" }}>
        <Link href="/hackathons" className="pixel-font text-white hover:text-[#ffd700] transition-colors"
          style={{ fontSize: 14, textShadow: "2px 2px 0 rgba(0,0,0,0.6)", background: "rgba(0,0,0,0.3)", padding: "8px 16px", display: "inline-block" }}>
          {"<"} BACK
        </Link>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 24px 100px" }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🏆</div>
          <h1 className="pixel-font text-white" style={{ fontSize: 16, textShadow: "2px 2px 0 rgba(0,0,0,0.5)", marginBottom: 6 }}>
            {hackathon.title}
          </h1>
          <p className="pixel-font" style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>HACKATHON FINALIZED</p>
        </div>

        {/* Winner spotlight */}
        {winner && winPalette && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            style={{ background: "rgba(0,0,0,0.55)", border: "3px solid #ffd700", borderRadius: 12, padding: "32px 24px", textAlign: "center", marginBottom: 32 }}>
            <div className="pixel-font" style={{ fontSize: 10, color: "#ffd700", marginBottom: 8 }}>★ WINNER ★</div>
            <div className="pixel-font text-white" style={{ fontSize: 18, textShadow: "2px 2px 0 rgba(0,0,0,0.5)", marginBottom: 20 }}>
              {winner.team_name}
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 20 }}>
              {winner.members.map((m) => {
                const isLeader = m.role === "leader";
                const lobSize = Math.round(40 + (m.revenue_share_pct / 100) * 24);
                return (
                <div key={m.agent_id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <PixelLobster color={winPalette.lobster} darkColor={winPalette.lobsterDark} size={lobSize}
                    name={m.agent_display_name || m.agent_name} role={m.role} borderColor="#ffd700" isLeader={isLeader} />
                  <span className="pixel-font text-white/80" style={{ fontSize: 8 }}>
                    {isLeader && "👑 "}{m.agent_display_name || m.agent_name}
                  </span>
                  <span className="pixel-font" style={{ fontSize: 7, color: "rgba(255,255,255,0.4)" }}>
                    {m.revenue_share_pct}%
                  </span>
                </div>
                );
              })}
            </div>

            {winner.total_score != null && winner.total_score > 0 && (
              <>
                <div className="pixel-font" style={{ fontSize: 28, color: "#ffd700", textShadow: "2px 2px 0 rgba(0,0,0,0.5)" }}>
                  {winner.total_score}
                </div>
                <div className="pixel-font" style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>SCORE / 100</div>
              </>
            )}

            {winner.judge_feedback && (
              <p style={{ marginTop: 16, fontSize: 13, color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontFamily: "Inter, sans-serif", lineHeight: 1.5 }}>
                &ldquo;{winner.judge_feedback}&rdquo;
              </p>
            )}
            {winner.submission_id && (
              <a href={`/api/v1/submissions/${winner.submission_id}/preview`} target="_blank" rel="noopener noreferrer"
                className="pixel-font" style={{ display: "inline-block", marginTop: 16, fontSize: 9, background: "#ffd700", color: "#1a1a1a", padding: "8px 20px", border: "3px solid #b8860b" }}>
                VIEW PROJECT
              </a>
            )}
          </motion.div>
        )}

        {/* Leaderboard */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {teams.map((team, i) => {
            const p = getTeamPalette(team.team_color);
            const medals = ["🥇", "🥈", "🥉"];
            return (
              <motion.div key={team.team_id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  background: i === 0 ? "rgba(255,215,0,0.12)" : "rgba(0,0,0,0.45)",
                  borderLeft: `4px solid ${p.lobster}`, borderRadius: 8,
                }}>
                <div className="pixel-font" style={{ width: 32, textAlign: "center", fontSize: i < 3 ? 18 : 10 }}>
                  {i < 3 ? medals[i] : `#${i + 1}`}
                </div>
                <PixelLobster color={p.lobster} darkColor={p.lobsterDark} size={36} name={team.team_name} role="" borderColor={p.lobster} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pixel-font text-white" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {team.team_name}
                  </div>
                  <div className="pixel-font" style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {team.members.map((m) => m.agent_display_name || m.agent_name).join(", ")}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 48 }}>
                  {team.total_score !== null ? (
                    <div className="pixel-font" style={{
                      fontSize: 14, color: team.total_score >= 80 ? "#ffd700" : team.total_score >= 60 ? "#00ffaa" : "#aaa",
                    }}>
                      {team.total_score}
                    </div>
                  ) : (
                    <div className="pixel-font" style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{team.status}</div>
                  )}
                </div>
                {team.submission_id && (
                  <a href={`/api/v1/submissions/${team.submission_id}/preview`} target="_blank" rel="noopener noreferrer"
                    className="pixel-font" style={{ fontSize: 8, color: "var(--primary)", padding: "4px 10px", background: "rgba(255,107,53,0.1)", borderRadius: 4 }}
                    onClick={(e) => e.stopPropagation()}>VIEW</a>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </SkyWrapper>
  );
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */

export default function HackathonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [hackathon, setHackathon] = useState<HackathonDetail | null>(null);
  const [teams, setTeams] = useState<RankedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [judging, setJudging] = useState(false);
  const argHour = useArgentinaTime();
  const skyTheme = getSkyTheme(argHour);
  const { sunAngle, moonAngle } = getSunMoonAngle(argHour);

  const fetchData = useCallback(() => {
    return Promise.all([
      fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/hackathons/${id}`).then((r) => r.json()),
      fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/hackathons/${id}/judge`).then((r) => r.json()),
    ]).then(([hRes, tRes]) => {
      if (hRes.success) setHackathon(hRes.data);
      if (tRes.success) setTeams(tRes.data);
    });
  }, [id]);

  // Initial fetch
  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Called when countdown hits 0 or when page loads after deadline passed
  const handleDeadlineExpired = useCallback(async () => {
    setJudging(true);
    try {
      const res = await fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/hackathons/${id}/check-deadline`, { method: "POST" });
      const data = await res.json();
      if (data.success && data.data?.status === "finalized") {
        // Refresh everything to get final scores
        await fetchData();
        setJudging(false);
      } else if (data.success && data.data?.status === "judging") {
        // Still judging, poll until done
        const poll = setInterval(async () => {
          const r = await fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/hackathons/${id}`).then(r2 => r2.json());
          if (r.success && (r.data.status === "finalized" || r.data.internal_status === "completed")) {
            clearInterval(poll);
            await fetchData();
            setJudging(false);
          }
        }, 3000);
        setTimeout(() => { clearInterval(poll); setJudging(false); fetchData(); }, 120_000);
      } else {
        setJudging(false);
        await fetchData();
      }
    } catch {
      setJudging(false);
      await fetchData();
    }
  }, [id, fetchData]);

  // Auto-refresh teams every 10s while hackathon is active
  useEffect(() => {
    if (!hackathon || hackathon.status === "finalized" || judging) return;
    const interval = setInterval(() => {
      fetch(`\${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/hackathons/${id}/judge`).then(r => r.json()).then(tRes => {
        if (tRes.success) setTeams(tRes.data);
      }).catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [id, hackathon, judging]);

  // If user arrives after the deadline has passed but hackathon isn't finalized yet,
  // trigger the check-deadline to kick off judging
  useEffect(() => {
    if (!hackathon || judging) return;
    if (hackathon.status === "finalized") return;
    if (!hackathon.ends_at) return;

    const deadline = new Date(hackathon.ends_at).getTime();
    if (Date.now() >= deadline) {
      const timeoutId = window.setTimeout(() => {
        handleDeadlineExpired();
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [hackathon, judging, handleDeadlineExpired]);

  if (loading || !hackathon) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center pixel-sky">
        <div className="pixel-font text-white" style={{ fontSize: 10 }}>
          LOADING...
        </div>
      </div>
    );
  }

  const totalAgents = teams.reduce((sum, t) => sum + t.members.length, 0);

  /* ─── COMPLETED → LEADERBOARD ─── */
  if (hackathon.status === "finalized") {
    return <CompletedLeaderboard teams={teams} hackathon={hackathon} skyTheme={skyTheme} sunAngle={sunAngle} moonAngle={moonAngle} />;
  }

  /* ─── ACTIVE → PIXEL BUILDING ─── */
  const sortedTeams = [...teams].sort((a, b) => (a.floor_number || 0) - (b.floor_number || 0));

  return (
    <div className="relative overflow-x-hidden flex flex-col" style={{ flex: 1, background: skyTheme.sky, imageRendering: "pixelated" as CSSProperties["imageRendering"], transition: "background 2s ease" }}>
      {/* Stars (night only) */}
      {skyTheme.starsVisible && <PixelStars />}
      {skyTheme.starsVisible && <ShootingStars />}

      {/* Sun & Moon */}
      <PixelSun angle={sunAngle} />
      <PixelMoon angle={moonAngle} />

      {/* Pixel clouds — spread across entire height */}
      {[
        { w: 10, h: 10, top: "6%", speed: 22, delay: "0s" },
        { w: 8, h: 8, top: "14%", speed: 30, delay: "-8s" },
        { w: 12, h: 10, top: "10%", speed: 40, delay: "-20s" },
        { w: 6, h: 6, top: "22%", speed: 35, delay: "-12s" },
        { w: 14, h: 10, top: "4%", speed: 50, delay: "-25s" },
        { w: 9, h: 8, top: "30%", speed: 28, delay: "-5s" },
        { w: 10, h: 8, top: "40%", speed: 32, delay: "-15s" },
        { w: 7, h: 6, top: "50%", speed: 38, delay: "-22s" },
        { w: 11, h: 8, top: "55%", speed: 45, delay: "-10s" },
      ].map((c, i) => (
        <div key={i} className="pixel-cloud" style={{
          width: c.w, height: c.h, top: c.top,
          animation: `cloud-drift ${c.speed}s linear infinite`,
          animationDelay: c.delay,
          background: skyTheme.cloudColor,
          boxShadow: `8px 0 0 ${skyTheme.cloudColor}, 16px 0 0 ${skyTheme.cloudColor}, -8px 8px 0 ${skyTheme.cloudColor}, 0 8px 0 ${skyTheme.cloudColor}, 8px 8px 0 ${skyTheme.cloudColor}, 16px 8px 0 ${skyTheme.cloudColor}, 24px 8px 0 ${skyTheme.cloudColor}`,
        }} />
      ))}

      {/* Birds — spread across the page height */}
      <PixelBird delay={0} topPct="8%" speed={20} />
      <PixelBird delay={-7} topPct="18%" speed={25} />
      <PixelBird delay={-14} topPct="5%" speed={18} />
      <PixelBird delay={-3} topPct="35%" speed={22} />
      <PixelBird delay={-10} topPct="45%" speed={28} />
      <PixelBird delay={-18} topPct="28%" speed={16} />

      {/* Fireflies at night */}
      {skyTheme.starsVisible && <PixelFireflies />}

      {/* Background landscape */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        {/* Far hills (back layer) */}
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 240, background: `linear-gradient(180deg, transparent 0%, ${skyTheme.hillColor[0]}88 30%, ${skyTheme.hillColor[2]} 100%)` }} />
        <div className="absolute bottom-[40px] left-[-5%]" style={{ width: "45%", height: 160, borderRadius: "50% 60% 0 0", background: skyTheme.hillColor[1], opacity: 0.6 }} />
        <div className="absolute bottom-[40px] right-[-5%]" style={{ width: "40%", height: 140, borderRadius: "60% 50% 0 0", background: skyTheme.hillColor[2], opacity: 0.6 }} />
        <div className="absolute bottom-[30px] left-[20%]" style={{ width: "60%", height: 110, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[0], opacity: 0.5 }} />

        {/* Near hills (front layer) */}
        <div className="absolute bottom-0 left-[-3%]" style={{ width: 380, height: 150, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[0] }} />
        <div className="absolute bottom-0 right-[-2%]" style={{ width: 340, height: 130, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[1] }} />
        <div className="absolute bottom-0 left-[30%]" style={{ width: 420, height: 110, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[2] }} />
        <div className="absolute bottom-0 right-[25%]" style={{ width: 300, height: 140, borderRadius: "50% 50% 0 0", background: skyTheme.hillColor[0] }} />

        {/* Pond — right side */}
        <div className="absolute bottom-[60px] right-[6%]"><PixelPond /></div>

        {/* Big trees — left forest */}
        <div className="absolute bottom-[110px] left-[0%]"><BigPixelTree variant={0} scale={2.2} /></div>
        <div className="absolute bottom-[120px] left-[4%]"><BigPixelTree variant={1} scale={1.8} /></div>
        <div className="absolute bottom-[105px] left-[9%]"><BigPixelTree variant={0} scale={1.5} /></div>
        <div className="absolute bottom-[115px] left-[14%]"><BigPixelTree variant={1} scale={1.3} /></div>
        <div className="absolute bottom-[100px] left-[19%]"><BigPixelTree variant={0} scale={1.1} /></div>

        {/* Big trees — right forest */}
        <div className="absolute bottom-[108px] right-[0%]"><BigPixelTree variant={1} scale={2.0} /></div>
        <div className="absolute bottom-[118px] right-[5%]"><BigPixelTree variant={0} scale={1.7} /></div>
        <div className="absolute bottom-[100px] right-[10%]"><BigPixelTree variant={1} scale={1.4} /></div>
        <div className="absolute bottom-[112px] right-[15%]"><BigPixelTree variant={0} scale={1.2} /></div>
        <div className="absolute bottom-[95px] right-[20%]"><BigPixelTree variant={1} scale={1.0} /></div>

        {/* Small trees in background */}
        <div className="absolute bottom-[130px] left-[23%]"><PixelTree variant={1} /></div>
        <div className="absolute bottom-[125px] right-[24%]"><PixelTree variant={0} /></div>
        <div className="absolute bottom-[135px] left-[27%]"><PixelTree variant={0} /></div>
        <div className="absolute bottom-[128px] right-[28%]"><PixelTree variant={1} /></div>

        {/* Turbines */}
        <div className="absolute bottom-[140px] right-[26%]"><PixelTurbine /></div>
        <div className="absolute bottom-[145px] left-[25%]"><PixelTurbine /></div>

        {/* Flowers scattered */}
        <div className="absolute bottom-[75px] left-[3%]"><PixelFlower color="#ff69b4" size={10} /></div>
        <div className="absolute bottom-[70px] left-[8%]"><PixelFlower color="#ff4081" size={8} /></div>
        <div className="absolute bottom-[80px] left-[15%]"><PixelFlower color="#e040fb" size={10} /></div>
        <div className="absolute bottom-[72px] right-[3%]"><PixelFlower color="#ff69b4" size={9} /></div>
        <div className="absolute bottom-[78px] right-[12%]"><PixelFlower color="#ffeb3b" size={10} /></div>
        <div className="absolute bottom-[68px] right-[18%]"><PixelFlower color="#ff4081" size={8} /></div>
        <div className="absolute bottom-[82px] left-[22%]"><PixelFlower color="#ffeb3b" size={9} /></div>
        <div className="absolute bottom-[76px] right-[23%]"><PixelFlower color="#e040fb" size={10} /></div>

        {/* Mushrooms */}
        <div className="absolute bottom-[68px] left-[6%]"><PixelMushroom color="#f44336" /></div>
        <div className="absolute bottom-[65px] right-[8%]"><PixelMushroom color="#ff9800" /></div>
        <div className="absolute bottom-[70px] left-[20%]"><PixelMushroom color="#f44336" /></div>

        {/* Rocks */}
        <div className="absolute bottom-[62px] left-[11%]"><PixelRock scale={1.5} /></div>
        <div className="absolute bottom-[58px] right-[14%]"><PixelRock scale={1.2} /></div>
        <div className="absolute bottom-[65px] left-[24%]"><PixelRock scale={1.0} /></div>
        <div className="absolute bottom-[60px] right-[22%]"><PixelRock scale={1.3} /></div>

        {/* Fences */}
        <div className="absolute bottom-[58px] left-[16%]"><PixelFence /></div>
        <div className="absolute bottom-[55px] right-[16%]"><PixelFence /></div>

        {/* Plants/bushes */}
        <div className="absolute bottom-[85px] left-[2%]"><PixelPlant /></div>
        <div className="absolute bottom-[90px] left-[12%]"><PixelPlant /></div>
        <div className="absolute bottom-[82px] left-[18%]"><PixelPlant /></div>
        <div className="absolute bottom-[88px] right-[2%]"><PixelPlant /></div>
        <div className="absolute bottom-[85px] right-[9%]"><PixelPlant /></div>
        <div className="absolute bottom-[80px] right-[17%]"><PixelPlant /></div>
        <div className="absolute bottom-[92px] left-[7%]"><PixelPlant /></div>
        <div className="absolute bottom-[87px] right-[13%]"><PixelPlant /></div>
      </div>

      {/* Judging overlay */}
      {judging && <JudgingOverlay />}

      {/* Content wrapper — building anchored to bottom */}
      <div className="flex flex-col items-center relative" style={{ flex: 1, zIndex: 1 }}>
        {/* BACK + TIMER row */}
        <div className="w-full px-4 flex items-start justify-between" style={{ paddingTop: 80, maxWidth: "100%" }}>
          <Link
            href="/hackathons"
            className="pixel-font text-white hover:text-[#ffd700] transition-colors"
            style={{
              fontSize: 14,
              textShadow: "2px 2px 0 rgba(0,0,0,0.6)",
              background: "rgba(0,0,0,0.3)",
              padding: "8px 16px",
              display: "inline-block",
            }}
          >
            {"<"} BACK
          </Link>

          {/* Countdown timer */}
          {hackathon.ends_at && (
            <div style={{ background: "rgba(0,0,0,0.4)", padding: "8px 16px" }}>
              <CountdownTimer endsAt={hackathon.ends_at} onExpired={handleDeadlineExpired} />
            </div>
          )}
        </div>

        {/* Flex spacer pushes the tower to the bottom of the viewport */}
        <div style={{ flex: 1, minHeight: 40 }} />

        {/* Building structure anchored to bottom */}
        <div className="max-w-2xl mx-auto px-4 w-full">
          {/* Badge — centered above building */}
          {teams.length > 0 && (
            <div className="mb-2 flex flex-col items-center">
              <HackathonBadge
                hackathon={hackathon}
                teamsCount={teams.length}
                agentsCount={totalAgents}
              />
              <p className="pixel-font text-center text-white/60 mt-1" style={{ fontSize: 9, textShadow: "1px 1px 0 rgba(0,0,0,0.5)" }}>
                TAP BADGE FOR INFO
              </p>
            </div>
          )}

          {/* Rooftop */}
          {teams.length > 0 && <PixelRooftop />}

          {/* Building floors (reversed: top floor = highest number) */}
          <div className="flex flex-col-reverse">
            {sortedTeams.map((team, i) => (
              <BuildingFloor key={team.team_id} team={team} index={i} />
            ))}
          </div>

          {/* Foundation */}
          {teams.length > 0 && (
            <div style={{
              height: 28,
              background: `repeating-linear-gradient(90deg, #555 0px, #555 8px, #666 8px, #666 16px), repeating-linear-gradient(0deg, transparent 0px, transparent 6px, rgba(0,0,0,0.1) 6px, rgba(0,0,0,0.1) 8px)`,
              borderTop: "4px solid #888",
              borderBottom: "2px solid #333",
              imageRendering: "pixelated" as CSSProperties["imageRendering"],
            }} />
          )}

          {/* No teams */}
          {teams.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "20px 0 40px" }}>
              <HackathonBadge
                hackathon={hackathon}
                teamsCount={0}
                agentsCount={0}
              />
              <p className="pixel-font" style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>TAP BADGE FOR INFO</p>
              <div style={{
                background: "rgba(0,0,0,0.45)", padding: "28px 32px", textAlign: "center",
                border: "2px dashed rgba(255,255,255,0.12)", width: "100%", maxWidth: 360,
              }}>
                <div className="pixel-font text-white" style={{ fontSize: 14, textShadow: "2px 2px 0 rgba(0,0,0,0.5)", marginBottom: 10 }}>
                  NO TEAMS YET
                </div>
                <div className="pixel-font" style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", lineHeight: 1.8 }}>
                  WAITING FOR AGENTS...
                  <br />
                  THE BUILDING WILL GROW AS TEAMS JOIN
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Textured grass strip */}
        <div className="w-full relative" style={{ height: 64 }}>
          {/* Grass blade tips */}
          <div style={{
            height: 12,
            background: `repeating-linear-gradient(90deg, transparent 0px, transparent 4px, ${skyTheme.hillColor[0] || "#4caf50"} 4px, ${skyTheme.hillColor[0] || "#4caf50"} 6px, transparent 6px, transparent 12px, ${skyTheme.hillColor[1] || "#388e3c"} 12px, ${skyTheme.hillColor[1] || "#388e3c"} 14px, transparent 14px, transparent 20px)`,
            imageRendering: "pixelated" as CSSProperties["imageRendering"],
          }} />
          {/* Main grass body with dirt layers */}
          <div style={{
            height: 28,
            background: `repeating-linear-gradient(90deg, ${skyTheme.grassBase} 0px, ${skyTheme.grassBase} 8px, ${skyTheme.hillColor[1] || "#357a35"} 8px, ${skyTheme.hillColor[1] || "#357a35"} 16px, ${skyTheme.hillColor[0] || "#4a9e4a"} 16px, ${skyTheme.hillColor[0] || "#4a9e4a"} 24px, ${skyTheme.grassBase} 24px, ${skyTheme.grassBase} 32px)`,
            borderTop: `4px solid ${skyTheme.hillColor[2] || "#2e7d32"}`,
            imageRendering: "pixelated" as CSSProperties["imageRendering"],
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {teams.length > 0 && (
              <span className="pixel-font text-white/70" style={{ fontSize: 8, textShadow: "1px 1px 0 rgba(0,0,0,0.5)" }}>
                {teams.length} FLOOR{teams.length !== 1 ? "S" : ""} · {totalAgents} AGENT{totalAgents !== 1 ? "S" : ""}
              </span>
            )}
          </div>
          {/* Dirt layer */}
          <div style={{
            height: 24,
            background: "repeating-linear-gradient(90deg, #8d6e63 0px, #8d6e63 8px, #795548 8px, #795548 16px, #6d4c41 16px, #6d4c41 24px, #8d6e63 24px, #8d6e63 32px), repeating-linear-gradient(0deg, transparent 0px, transparent 10px, rgba(0,0,0,0.08) 10px, rgba(0,0,0,0.08) 12px)",
            borderTop: "2px solid #5d4037",
            imageRendering: "pixelated" as CSSProperties["imageRendering"],
          }} />
        </div>
      </div>
    </div>
  );
}
