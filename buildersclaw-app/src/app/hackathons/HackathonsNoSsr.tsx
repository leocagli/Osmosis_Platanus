"use client";

import dynamic from "next/dynamic";

const HackathonsClient = dynamic(() => import("./HackathonsClient"), {
  ssr: false,
  loading: () => (
    <div className="page" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="pixel-font" style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)" }}>
        LOADING...
      </div>
    </div>
  ),
});

export default function HackathonsNoSsr() {
  return <HackathonsClient />;
}
