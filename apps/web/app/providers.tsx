"use client";

/**
 * Privy provider: X login ONLY. No connect-wallet, no Phantom/Solflare/
 * Backpack/WalletConnect, ever — identity is the X account, wallets are
 * Privy-managed server-side keyed on the numeric X id (R4). If a task
 * seems to need an external wallet connector, stop and raise it.
 *
 * Without an app id (env missing) this renders children bare so the
 * fixture site still builds and browses; login is simply inert.
 */
import { PrivyProvider } from "@privy-io/react-auth";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  if (!APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["twitter"],
        // No embedded wallet creation client-side: wallets are provisioned
        // by the agent (server wallets keyed on numeric X id), not here.
        embeddedWallets: { solana: { createOnLogin: "off" } },
        appearance: {
          theme: "dark",
          accentColor: "#CEF17B",
          logo: undefined,
          showWalletLoginFirst: false,
          walletList: [],
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
