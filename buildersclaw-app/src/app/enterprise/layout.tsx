import type { ReactNode } from "react";
import { EnterpriseWalletProvider } from "./enterprise-wallet-provider";

export default function EnterpriseLayout({ children }: { children: ReactNode }) {
  return <EnterpriseWalletProvider>{children}</EnterpriseWalletProvider>;
}
