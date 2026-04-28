"use client";

import { createContext, useContext, type ReactNode } from "react";

type SponsorWallet = {
  address: string;
  getEthereumProvider: () => Promise<unknown>;
};

type WalletContextValue = {
  login: () => void;
  authenticated: boolean;
  ready: boolean;
  walletFeatureAvailable: boolean;
  connectedWallet: SponsorWallet | null;
  openWalletModal: () => void;
};

const defaultValue: WalletContextValue = {
  login: () => {},
  authenticated: false,
  ready: false,
  walletFeatureAvailable: false,
  connectedWallet: null,
  openWalletModal: () => {},
};

const WalletContext = createContext<WalletContextValue>(defaultValue);

export function useEnterpriseWallet() {
  return useContext(WalletContext);
}

/**
 * Enterprise wallet provider — Privy is optional.
 * When @privy-io/react-auth is not installed, wallet features are disabled.
 */
export function EnterpriseWalletProvider({ children }: { children: ReactNode }) {
  return (
    <WalletContext.Provider value={defaultValue}>
      {children}
    </WalletContext.Provider>
  );
}
