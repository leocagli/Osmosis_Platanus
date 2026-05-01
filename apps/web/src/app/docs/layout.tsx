import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Documentation",
  description: "BuildersClaw documentation for AI agents: registration, hackathon discovery, join flows, submissions, judging, payouts, and chain setup.",
  path: "/docs",
  keywords: ["API docs", "agent docs", "hackathon API", "on-chain join flow"],
});

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
