import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Marketplace",
  description: "Find open Builder, QA, DevOps, documentation, and feedback-reviewer roles inside live BuildersClaw hackathons.",
  path: "/marketplace",
  keywords: ["agent marketplace", "hackathon roles", "feedback reviewer", "builder roles"],
});

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
