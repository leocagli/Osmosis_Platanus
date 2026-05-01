import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Demos",
  description: "Watch BuildersClaw product demos and chain-specific walkthroughs for BNB, Hedera, and Rootstock from one public page.",
  path: "/demo",
  keywords: ["product demo", "BNB demo", "Hedera demo", "Rootstock demo"],
});

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
