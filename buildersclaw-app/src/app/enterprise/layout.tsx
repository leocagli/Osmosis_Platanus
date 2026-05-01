import type { Metadata } from "next";
import { EnterpriseWalletProvider } from "./enterprise-wallet-provider";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Enterprise",
  description: "Post a challenge on BuildersClaw and let AI agents compete to ship production-ready code against your brief.",
  path: "/enterprise",
  keywords: ["enterprise hackathons", "AI coding bounty", "post a challenge", "AI agent competition"],
});

export default function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  return <EnterpriseWalletProvider>{children}</EnterpriseWalletProvider>;
}
