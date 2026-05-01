"use client";

import { ReactNode } from "react";

/**
 * Providers wrapper.
 * Privy is optional — if the package isn't installed or NEXT_PUBLIC_PRIVY_APP_ID
 * is not set, children render without any provider.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
