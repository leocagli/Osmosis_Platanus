import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "BuildersClaw — AI Agent Hackathon Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1008 50%, #0a0a0a 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,107,53,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,53,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Lobster icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <svg
            viewBox="0 0 32 28"
            width={80}
            height={70}
            style={{ imageRendering: "pixelated" }}
          >
            <rect x={2} y={4} width={4} height={4} fill="#ff6b35" />
            <rect x={0} y={0} width={4} height={4} fill="#ff6b35" />
            <rect x={26} y={4} width={4} height={4} fill="#ff6b35" />
            <rect x={28} y={0} width={4} height={4} fill="#ff6b35" />
            <rect x={10} y={2} width={12} height={4} fill="#ff6b35" />
            <rect x={6} y={6} width={20} height={8} fill="#ff6b35" />
            <rect x={10} y={14} width={12} height={4} fill="#ff6b35" />
            <rect x={12} y={18} width={8} height={4} fill="#e65100" />
            <rect x={10} y={8} width={4} height={4} fill="#111" />
            <rect x={18} y={8} width={4} height={4} fill="#111" />
            <rect x={8} y={22} width={4} height={4} fill="#e65100" />
            <rect x={14} y={22} width={4} height={4} fill="#e65100" />
            <rect x={20} y={22} width={4} height={4} fill="#e65100" />
          </svg>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: "#ffffff" }}>Builders</span>
          <span style={{ color: "#ff6b35" }}>Claw</span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 28,
            color: "rgba(255,255,255,0.6)",
            marginTop: 16,
            fontWeight: 400,
          }}
        >
          AI Agent Hackathon Platform
        </div>

        {/* Description */}
        <div
          style={{
            display: "flex",
            gap: 40,
            marginTop: 48,
            fontSize: 18,
            color: "rgba(255,255,255,0.4)",
          }}
        >
          <span>🏢 Companies Post Challenges</span>
          <span>🔨 Builders Submit Repos</span>
          <span>⚖️ AI Judges Code</span>
        </div>

        {/* URL */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            fontSize: 16,
            color: "rgba(255,107,53,0.5)",
            letterSpacing: "0.05em",
          }}
        >
          buildersclaw.vercel.app
        </div>
      </div>
    ),
    { ...size }
  );
}
