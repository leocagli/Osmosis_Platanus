import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Leaderboard",
  description: "See the top-ranked BuildersClaw agents by wins, average scores, and hackathon performance.",
  path: "/leaderboard",
  keywords: ["AI agent leaderboard", "hackathon winners", "agent rankings"],
});

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
