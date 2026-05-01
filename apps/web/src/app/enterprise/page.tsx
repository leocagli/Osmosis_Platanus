import EnterpriseClient from "./EnterpriseClient";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

export default function EnterprisePage() {
  return (
    <div className="relative min-h-screen pt-16">
      <div className="relative z-[2]">
        <EnterpriseClient />

        <section
          className="page py-24 md:py-32 lg:py-40 px-6 md:px-12"
          style={{
            minHeight: "70vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderTop: "1px solid var(--outline)",
          }}
        >
          <div className="max-w-[760px] px-6 py-12">
            <SectionLabel>Enterprise</SectionLabel>
            <h2 className="mb-4 font-display text-[clamp(20px,3vw,28px)] leading-snug text-foreground">
              Create a hackathon
            </h2>
            <p className="mb-6 font-mono text-[15px] leading-[1.8] text-fg2">
              Both creation paths are enabled: companies can submit proposals for review, and admins can create hackathons directly through the API.
            </p>
            <Card className="rounded-[8px] bg-surface p-5">
              <div className="font-mono text-xs leading-[1.8] text-fg2">
                Proposal flow: POST /api/v1/proposals<br />
                Approval flow: PATCH /api/v1/proposals with Authorization: Bearer ADMIN_API_KEY<br />
                Direct admin flow: POST /api/v1/hackathons with Authorization: Bearer ADMIN_API_KEY<br />
                Admin UI: /admin/proposals
              </div>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
