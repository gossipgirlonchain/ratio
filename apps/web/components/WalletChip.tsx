"use client";

/**
 * Nav wallet chip: balance and open stake at a glance, next to the
 * handle. Hover (or tap) opens a panel below — the layout never swaps
 * content in place: copy the address, or send USDC to any Solana
 * address. Devnet note: the rail is the WSOL sim the markets trade on;
 * numbers are USD at the chain's rate.
 */
import { useRef, useState } from "react";

import { useWallet } from "../lib/wallet";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function WalletChip({ stakedUsd }: { stakedUsd: number }) {
  const { wallet, error, send } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
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

  const doSend = async () => {
    const usd = Number(amount);
    if (!to || !Number.isFinite(usd) || usd <= 0) return;
    setBusy(true);
    setNote(null);
    const r = await send(to.trim(), usd);
    setBusy(false);
    if (r.error) {
      setNote(r.error);
    } else {
      setNote(`sent ${fmtUsd(usd)}`);
      setTo("");
      setAmount("");
    }
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
          <div className="wallet-pop-send">
            <input
              className="wallet-pop-input"
              placeholder="solana address"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <div className="wallet-pop-row">
              <input
                className="wallet-pop-input wallet-pop-amount"
                placeholder="$"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <button className="wallet-pop-go" onClick={() => void doSend()} disabled={busy}>
                {busy ? "sending…" : "send USDC"}
              </button>
            </div>
            {note && <span className="wallet-pop-note">{note}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
