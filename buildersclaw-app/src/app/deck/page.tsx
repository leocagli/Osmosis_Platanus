import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Pitch Deck",
  description: "View the BuildersClaw pitch deck and product overview.",
  path: "/deck",
  keywords: ["pitch deck", "startup deck", "product overview"],
});

const DECK_SRC = "/deck/deck.pdf";

export default function DeckPage() {
  return (
    <section style={{ maxWidth: 1200, margin: "0 auto", padding: "96px 20px 64px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div>
          <div
            className="pixel-font"
            style={{ fontSize: 9, color: "var(--primary)", letterSpacing: "0.12em", marginBottom: 8 }}
          >
            BUILDERSCLAW
          </div>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", margin: 0 }}>Pitch Deck</h1>
          <p style={{ marginTop: 10, color: "var(--text-muted)", maxWidth: 700 }}>
            The deck is embedded below. If your browser blocks inline PDF viewing, open it in a new tab or download it directly.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href={DECK_SRC}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            Open PDF
          </a>
          <a href={DECK_SRC} download className="btn" style={{ border: "2px solid var(--outline)" }}>
            Download
          </a>
        </div>
      </div>

      <div
        style={{
          background: "var(--s-low)",
          border: "1px solid var(--outline)",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.28)",
        }}
      >
        <iframe
          src={DECK_SRC}
          title="BuildersClaw pitch deck"
          style={{ display: "block", width: "100%", height: "calc(100vh - 220px)", minHeight: 720, border: 0 }}
        />
      </div>
    </section>
  );
}
