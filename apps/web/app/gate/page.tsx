"use client";

/**
 * The front door of the devnet beta. Unbranded on purpose: no wordmark, no
 * product name, no chain, no faucet link. Two words, one field, one button.
 *
 * Anyone hitting this without a code should learn nothing from it, which
 * includes not learning what the product is called.
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
        <p className="gate-sub">devnet beta</p>
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
      </div>
    </main>
  );
}
