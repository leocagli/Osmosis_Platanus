export default function HackathonsPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return (
    <div className="page" style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 680, textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 14, fontWeight: 400, marginBottom: 16 }}>
          {supabaseConfigured ? "Hackathons are loading" : "No local hackathons yet"}
        </div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7, margin: 0 }}>
          {supabaseConfigured
            ? "Refresh in a moment while the local server prepares the challenge feed."
            : "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to load live challenges."}
        </p>
      </div>
    </div>
  );
}
