"use client";

/**
 * Nav wallet chip: balance and open stake at a glance, next to the
 * handle. Hover (or tap) opens the DEPOSIT panel: this wallet's address
 * with one-tap copy — you fund it by sending to that address.
 * Withdrawing lives on the profile page, not here.
 */
import { useRef, useState } from "react";

import { useWallet } from "../lib/wallet";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function WalletChip({ stakedUsd }: { stakedUsd: number }) {
  const { wallet, error } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
  };
  const leave = () => {
    // grace period: crossing the gap to the panel must not close it
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };

  const copy = () => {
    if (!wallet) return;
    void navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Logged-in users ALWAYS see the chip. No wallet yet = a loading state
  // with the failure visible in the panel, never a silent disappearance.
  return (
    <div
      className="wallet-chip-wrap"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button className="wallet-chip" onClick={() => setOpen(!open)} title={wallet?.address ?? ""}>
        {wallet ? (
          <>
            <span className="wallet-chip-balance">{fmtUsd(wallet.balanceUsd)}</span>
            <span className="wallet-chip-staked">{fmtUsd(stakedUsd)} staked</span>
          </>
        ) : (
          <span className="wallet-chip-staked">wallet…</span>
        )}
      </button>
      {open && !wallet && (
        <div className="wallet-pop">
          <span className="wallet-pop-note">{error ?? "loading wallet…"}</span>
        </div>
      )}
      {open && wallet && (
        <div className="wallet-pop">
          <button className="wallet-pop-addr" onClick={copy} title="copy address">
            <span className="wallet-pop-mono">{copied ? "copied" : shortAddr(wallet.address)}</span>
            <span className="wallet-pop-copy">{copied ? "✓" : "copy"}</span>
          </button>
          <span className="wallet-pop-note">send devnet SOL to this address to top up</span>
          {wallet.rentUsd > 0 && (
            <span className="wallet-pop-note">
              {fmtUsd(wallet.rentUsd)} held as account rent, refunded when markets close
            </span>
          )}
        </div>
      )}
    </div>
  );
}
