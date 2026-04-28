"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  PrivyProvider,
  useConnectWallet,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { publicChain } from "@/lib/public-chain";

type SponsorWallet = {
  address: string;
  getEthereumProvider: () => Promise<unknown>;
  loginOrLink?: () => Promise<unknown>;
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

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_LOGIN_METHODS = (process.env.NEXT_PUBLIC_PRIVY_LOGIN_METHODS || "wallet,email")
  .split(",")
  .map((method) => method.trim())
  .filter(Boolean);

export function useEnterpriseWallet() {
  return useContext(WalletContext);
}

function WalletBridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();
  const wallet = useMemo<SponsorWallet | null>(() => {
    if (!privy.authenticated || wallets.length === 0) return null;

    const activeWallet = wallets[0];
    return {
      address: activeWallet.address,
      getEthereumProvider: () => activeWallet.getEthereumProvider(),
      loginOrLink: activeWallet.loginOrLink,
    };
  }, [privy.authenticated, wallets]);

  const openWalletModal = () => {
    if (privy.authenticated && wallets.length === 0) {
      connectWallet();
      return;
    }

    if (privy.authenticated && wallets[0]?.loginOrLink) {
      void wallets[0].loginOrLink();
      return;
    }

    privy.login();
  };

  return (
    <WalletContext.Provider
      value={{
        login: privy.login,
        authenticated: privy.authenticated,
        ready: privy.ready,
        walletFeatureAvailable: true,
        connectedWallet: wallet,
        openWalletModal,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function EnterpriseWalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <WalletContext.Provider value={defaultValue}>{children}</WalletContext.Provider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "dark" },
        defaultChain: publicChain,
        supportedChains: [publicChain],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        loginMethods: PRIVY_LOGIN_METHODS,
      }}
    >
      <WalletBridge>{children}</WalletBridge>
    </PrivyProvider>
  );
}
