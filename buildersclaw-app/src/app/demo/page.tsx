"use client";

import { useState } from "react";
import Link from "next/link";

type DemoEntry = {
  slug: "bnb" | "hedera" | "rootstock";
  title: string;
  network: string;
  summary: string;
  accent: string;
  videoSrc: string;
  fileName: string;
};

const DEMOS: DemoEntry[] = [
  {
    slug: "bnb",
    title: "BNB Demo",
    network: "BNB Chain",
    summary: "Preview the BNB build flow and hosted experience in one place.",
    accent: "#f0b90b",
    videoSrc: "/demo/bnb.mp4",
    fileName: "public/demo/bnb.mp4",
  },
  {
    slug: "hedera",
    title: "Hedera Demo",
    network: "Hedera",
    summary: "Show the Hedera-specific walkthrough without changing the route structure.",
    accent: "#7c3aed",
    videoSrc: "/demo/hedera.mp4",
    fileName: "public/demo/hedera.mp4",
  },
  {
    slug: "rootstock",
    title: "Rootstock Demo",
    network: "Rootstock",
    summary: "Keep the Rootstock submission easy to review from the same public hub.",
    accent: "#00d084",
    videoSrc: "/demo/rootstock.mp4",
    fileName: "public/demo/rootstock.mp4",
  },
];

function DemoCard({ demo }: { demo: DemoEntry }) {
  const [hasError, setHasError] = useState(false);

  return (
    <article
      style={{
        background: "linear-gradient(180deg, rgba(19,19,19,0.96), rgba(19,19,19,0.88))",
        border: "1px solid rgba(89,65,57,0.24)",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 22px 16px",
          borderBottom: "1px solid rgba(89,65,57,0.16)",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${demo.accent}44`,
              color: demo.accent,
              background: `${demo.accent}12`,
              fontSize: 11,
              fontFamily: "'Press Start 2P', monospace",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: demo.accent,
                boxShadow: `0 0 12px ${demo.accent}`,
              }}
            />
            {demo.network}
          </div>
          <h2
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 28,
              lineHeight: 1.1,
              marginBottom: 10,
            }}
          >
            {demo.title}
          </h2>
          <p style={{ color: "var(--text-dim)", lineHeight: 1.65, maxWidth: 560 }}>{demo.summary}</p>
        </div>

        <div
          style={{
            flexShrink: 0,
            minWidth: 112,
            padding: "12px 14px",
            borderRadius: 14,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(89,65,57,0.16)",
          }}
        >
          <div style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", marginBottom: 4 }}>
            Route
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>/demo#{demo.slug}</div>
        </div>
      </div>

      <div id={demo.slug} style={{ padding: 22 }}>
        <div
          style={{
            position: "relative",
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(89,65,57,0.2)",
            background:
              "radial-gradient(circle at top, rgba(255,107,53,0.14), rgba(0,0,0,0.72) 58%), linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
          }}
        >
          {!hasError ? (
            <video
              controls
              playsInline
              preload="metadata"
              style={{ display: "block", width: "100%", aspectRatio: "16 / 9", background: "#050505" }}
              onError={() => setHasError(true)}
            >
              <source src={demo.videoSrc} type="video/mp4" />
            </video>
          ) : (
            <div
              style={{
                aspectRatio: "16 / 9",
                display: "grid",
                placeItems: "center",
                padding: 32,
                textAlign: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "'Press Start 2P', monospace",
                    fontSize: 12,
                    color: demo.accent,
                    marginBottom: 16,
                  }}
                >
                  VIDEO MISSING
                </div>
                <p style={{ color: "var(--text-dim)", marginBottom: 10 }}>
                  Add <code>{demo.fileName}</code> to enable this preview.
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Expected public URL: {demo.videoSrc}</p>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 14,
            flexWrap: "wrap",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span>Source file: <code>{demo.fileName}</code></span>
          <a href={demo.videoSrc} target="_blank" rel="noreferrer" style={{ color: demo.accent }}>
            Open raw video
          </a>
        </div>
      </div>
    </article>
  );
}

export default function DemoPage() {
  return (
    <main
      style={{
        marginTop: 64,
        minHeight: "100vh",
        padding: "48px 48px 80px",
        background:
          "radial-gradient(circle at top, rgba(255,107,53,0.08), transparent 32%), radial-gradient(circle at 80% 20%, rgba(255,215,0,0.08), transparent 24%)",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <section style={{ padding: "32px 0 40px" }}>
          <div className="section-label">Demo Router</div>
          <h1
            style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: "clamp(24px, 3.2vw, 42px)",
              lineHeight: 1.35,
              marginBottom: 18,
              maxWidth: 880,
            }}
          >
            One public route for all three chain demos.
          </h1>
          <p style={{ maxWidth: 760, color: "var(--text-dim)", fontSize: 17, lineHeight: 1.7, marginBottom: 28 }}>
            Judges can open <code>/demo</code> and preview the BNB, Hedera, and Rootstock recordings from a single page.
            Each player reads directly from <code>public/demo/*.mp4</code>.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/hackathons" className="btn btn-primary">
              Back to hackathons
            </Link>
            <a href="#bnb" className="btn btn-outline">BNB</a>
            <a href="#hedera" className="btn btn-outline">Hedera</a>
            <a href="#rootstock" className="btn btn-outline">Rootstock</a>
          </div>
        </section>

        <section style={{ padding: 0 }}>
          <div
            style={{
              display: "grid",
              gap: 24,
            }}
          >
            {DEMOS.map((demo) => (
              <DemoCard key={demo.slug} demo={demo} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
