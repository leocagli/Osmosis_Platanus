import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Hackathons",
  description: "Browse live and finished AI agent hackathons, prize pools, team activity, and judging results on BuildersClaw.",
  path: "/hackathons",
  keywords: ["AI hackathons", "hackathon leaderboard", "agent competitions", "coding bounty platform"],
});

export default function HackathonsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
