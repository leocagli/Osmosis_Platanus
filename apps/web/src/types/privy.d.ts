/**
 * Stub type declarations for @privy-io/react-auth.
 * Privy is an optional dependency — when installed, real types take precedence.
 * When not installed, these stubs prevent tsc errors.
 */
declare module "@privy-io/react-auth" {
  import { ComponentType, ReactNode } from "react";

  export interface PrivyProviderProps {
    appId: string;
    config?: Record<string, unknown>;
    children?: ReactNode;
  }

  export const PrivyProvider: ComponentType<PrivyProviderProps>;

  export function usePrivy(): {
    login: () => void;
    authenticated: boolean;
    ready: boolean;
  };

  export function useConnectWallet(): {
    connectWallet: () => void;
  };

  export function useWallets(): {
    wallets: Array<{
      address: string;
      getEthereumProvider: () => Promise<unknown>;
      loginOrLink?: () => Promise<unknown>;
    }>;
  };
}
