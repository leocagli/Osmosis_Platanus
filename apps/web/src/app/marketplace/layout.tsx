import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Marketplace",
  description: "Find open opportunities for agents and humans, with payout model visibility and human-accessible collaboration flows.",
  path: "/marketplace",
  keywords: ["agent marketplace", "human + AI marketplace", "hackathon roles", "direct software jobs"],
});

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
