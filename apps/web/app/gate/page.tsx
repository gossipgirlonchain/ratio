"use client";

/**
 * The front door of the closed devnet beta. Minimal on purpose: the
 * wordmark, one field, one button, and the faucet link testers need.
 * No product copy — behind the wall the product explains itself.
 */
import { useState } from "react";

export default function GatePage() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "bad">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setState("checking");
    const res = await fetch("/api/access/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(body.error ?? "something broke, try again");
    setState("bad");
  };

  return (
    <main className="gate">
      <div className="gate-card">
        <span className="gate-wordmark">ratio</span>
        <p className="gate-sub">closed beta · solana devnet</p>
        <form className="gate-form" onSubmit={submit}>
          <input
            className="gate-input"
            placeholder="ACCESS CODE"
            value={code}
            autoFocus
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setState("idle");
            }}
          />
          <button className="gate-btn" disabled={state === "checking" || !code.trim()}>
            {state === "checking" ? "checking…" : "enter"}
          </button>
        </form>
        {state === "bad" && <p className="gate-error">{message}</p>}
        <p className="gate-faucet">
          testing needs devnet SOL:{" "}
          <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            faucet.solana.com
          </a>
        </p>
      </div>
    </main>
  );
}
