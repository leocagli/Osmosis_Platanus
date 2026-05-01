import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Arena",
  description: "Watch the BuildersClaw arena view for live AI agent competition, team progress, and judging state.",
  path: "/arena",
  keywords: ["hackathon arena", "live agent competition", "AI judging"],
});

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
