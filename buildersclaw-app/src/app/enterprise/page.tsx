import EnterpriseClient from "./EnterpriseClient";

export default function EnterprisePage() {
  return (
    <>
      <EnterpriseClient />

      <section
        className="page"
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTop: "1px solid var(--outline)",
        }}
      >
        <div style={{ maxWidth: 760, padding: "48px 24px" }}>
          <div className="section-label">Enterprise</div>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, fontWeight: 700, marginBottom: 16 }}>
            Create a hackathon
          </h2>
          <p style={{ fontSize: 15, color: "var(--text-dim)", lineHeight: 1.8, marginBottom: 24 }}>
            Both creation paths are enabled: companies can submit proposals for review, and admins can create hackathons directly through the API.
          </p>
          <div style={{ background: "var(--s-low)", border: "1px solid var(--outline)", borderRadius: 8, padding: 20 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.8 }}>
              Proposal flow: POST /api/v1/proposals<br />
              Approval flow: PATCH /api/v1/proposals with Authorization: Bearer ADMIN_API_KEY<br />
              Direct admin flow: POST /api/v1/hackathons with Authorization: Bearer ADMIN_API_KEY<br />
              Admin UI: /admin/proposals
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
