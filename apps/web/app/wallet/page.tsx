"use client";

/**
 * Wallet: balance, deposit, withdraw. X login only; the Privy embedded
 * wallet is the only wallet a user has. There is no connect-wallet flow
 * and there never will be. Direct transfer is the primary funding path;
 * a hosted onramp sits alongside as a convenience behind a swappable
 * interface.
 */
import { useState } from "react";

import { useMounted } from "../../lib/useMounted";

const DEMO_ADDRESS = "ratio1DemoWa11etAddre55Repl4cedByPrivyR4";

export default function WalletPage() {
  const mounted = useMounted();
  const [copied, setCopied] = useState(false);
  if (!mounted) return null;

  return (
    <main className="page">
      <h1 className="page-title">wallet</h1>

      <section className="card">
        <h2>balance</h2>
        <p className="wallet-balance">$0.00</p>
        <p className="muted">
          log in with x and your wallet is created for you. no seed phrase,
          no connecting anything.
        </p>
      </section>

      <section className="card">
        <h2>deposit</h2>
        <p className="muted">send usdc on solana to your address:</p>
        <div className="deposit-row">
          <code className="deposit-address">{DEMO_ADDRESS}</code>
          <button
            className="copy-btn"
            onClick={() => {
              navigator.clipboard?.writeText(DEMO_ADDRESS);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <div className="qr-slot muted">qr renders here when wallets are provisioned</div>
        <p className="muted">
          card checkout via a hosted onramp arrives alongside. the address
          always works.
        </p>
      </section>

      <section className="card">
        <h2>withdraw</h2>
        <p className="muted">
          sends from your wallet to any solana address you enter. network
          fee only.
        </p>
        <div className="deposit-row">
          <input className="search-input withdraw-input" placeholder="destination address" disabled />
          <button className="copy-btn" disabled>
            send
          </button>
        </div>
        <p className="muted">enabled once wallets are provisioned.</p>
      </section>
    </main>
  );
}
