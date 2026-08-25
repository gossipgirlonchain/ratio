"use client";

/**
 * Admin dashboard: code generator, code ledger, every market in the live
 * store, topline stats, faucet link. Auth is the ADMIN_KEY typed once
 * (kept in sessionStorage, sent as a header — one admin, one secret).
 */
import { useEffect, useState } from "react";

interface CodeRow {
  code: string;
  created_at_ms: number;
  note: string | null;
  max_uses?: number;
  use_count?: number;
  redeemed_at_ms: number | null;
}
interface MarketRow {
  id: string;
  author_a_handle: string;
  author_b_handle: string;
  status: string;
  winner: string | null;
  created_at_ms: number;
  settles_at_ms: number;
  likes_a_at_create: number;
  likes_b_at_create: number;
}
interface UserRow {
  xUserId: string;
  address: string;
  createdAtMs: number;
  handle: string | null;
  bets: number;
  stakedUsd: number;
  lastBetMs: number | null;
}

interface Overview {
  stats: {
    markets: number; open: number; settled: number; grossStakedUsd: number;
    bettors: number; bets: number; codesTotal: number; codesRedeemed: number;
    users: number;
  };
  markets: MarketRow[];
  users: UserRow[];
}

const fmtTime = (ms: number) => new Date(ms).toLocaleString();

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [entered, setEntered] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [freshCodes, setFreshCodes] = useState<string[]>([]);
  const [count, setCount] = useState("5");
  const [uses, setUses] = useState("1");
  const [error, setError] = useState("");
  const [showUsers, setShowUsers] = useState(false);

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: { ...(init?.headers ?? {}), "x-admin-key": key, "content-type": "application/json" },
    });
    if (res.status === 401) {
      setEntered(false);
      setError("wrong key");
      return null;
    }
    if (!res.ok) {
      setError(`request failed (${res.status})`);
      return null;
    }
    return res.json();
  };

  const refresh = async (k?: string) => {
    const useKey = k ?? key;
    if (!useKey) return;
    const [o, c] = await Promise.all([call("/api/admin/overview"), call("/api/admin/codes")]);
    if (o && c) {
      setOverview(o as Overview);
      setCodes((c as { codes: CodeRow[] }).codes);
      setEntered(true);
      setError("");
      sessionStorage.setItem("ratio-admin-key", useKey);
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("ratio-admin-key");
    if (saved) {
      setKey(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (key && !entered && sessionStorage.getItem("ratio-admin-key") === key) void refresh(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!entered) {
    return (
      <main className="page">
        <h1 className="page-title">admin</h1>
        <form
          className="admin-login"
          onSubmit={(e) => {
            e.preventDefault();
            void refresh();
          }}
        >
          <input
            className="rs-custom-input"
            type="password"
            placeholder="admin key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="gate-btn" disabled={!key}>open</button>
        </form>
        {error && <p className="gate-error">{error}</p>}
      </main>
    );
  }

  const s = overview?.stats;
  return (
    <main className="page page-boards">
      <h1 className="page-title">admin</h1>

      {s && (
        <div className="admin-stats">
          {([
            ["markets", s.markets],
            ["open", s.open],
            ["decided", s.settled],
            ["staked", `$${s.grossStakedUsd.toLocaleString("en-US")}`],
            ["users", s.users],
            ["bettors", s.bettors],
            ["bets", s.bets],
            ["codes", `${s.codesRedeemed}/${s.codesTotal} used`],
          ] as Array<[string, string | number]>).map(([label, value]) =>
            label === "users" ? (
              <button
                className={showUsers ? "admin-stat card admin-stat-tap admin-stat-on" : "admin-stat card admin-stat-tap"}
                key={label}
                onClick={() => setShowUsers(!showUsers)}
                title="show user list"
              >
                <span className="admin-stat-num">{value}</span>
                <span className="admin-stat-label">{label}</span>
              </button>
            ) : (
              <div className="admin-stat card" key={label}>
                <span className="admin-stat-num">{value}</span>
                <span className="admin-stat-label">{label}</span>
              </div>
            ),
          )}
        </div>
      )}

      {showUsers && overview && (
        <div className="card admin-table-card admin-users">
          <table className="table">
            <tbody>
              {overview.users.map((u) => (
                <tr key={u.xUserId}>
                  <td className="admin-code">{u.handle ? `@${u.handle}` : u.xUserId}</td>
                  <td className="muted-ink">{u.address.slice(0, 4)}…{u.address.slice(-4)}</td>
                  <td className="muted-ink">{u.bets} bets · ${u.stakedUsd.toLocaleString("en-US")}</td>
                  <td className="muted-ink">joined {fmtTime(u.createdAtMs)}</td>
                  <td className="muted-ink">{u.lastBetMs ? `last bet ${fmtTime(u.lastBetMs)}` : "no bets"}</td>
                </tr>
              ))}
              {overview.users.length === 0 && (
                <tr><td className="muted-ink">nobody yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="board-duo">
        <section>
          <h2 className="board-heading">access codes</h2>
          <div className="card admin-gen">
            <input
              className="scanner-num"
              style={{ width: 54 }}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              title="how many codes"
            />
            <label className="admin-uses">
              <span className="muted-ink">uses each</span>
              <input
                className="scanner-num"
                style={{ width: 64 }}
                inputMode="numeric"
                value={uses}
                onChange={(e) => setUses(e.target.value)}
              />
            </label>
            <button
              className="gate-btn"
              onClick={async () => {
                const r = (await call("/api/admin/codes", {
                  method: "POST",
                  body: JSON.stringify({ count: Number(count) || 1, uses: Number(uses) || 1 }),
                })) as { codes: string[] } | null;
                if (r) {
                  setFreshCodes(r.codes);
                  void refresh();
                }
              }}
            >
              generate
            </button>
            <a className="admin-faucet" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
              devnet faucet ↗
            </a>
          </div>
          {freshCodes.length > 0 && (
            <div className="card admin-fresh">
              {freshCodes.map((c) => (
                <button
                  key={c}
                  className="admin-code-chip"
                  onClick={() => navigator.clipboard?.writeText(c)}
                  title="copy"
                >
                  {c}
                </button>
              ))}
              <span className="muted-ink admin-fresh-hint">tap a code to copy it</span>
            </div>
          )}
          <div className="card admin-table-card">
            <table className="table">
              <tbody>
                {codes.map((c) => (
                  <tr key={c.code}>
                    <td className="admin-code">{c.code}</td>
                    <td className="muted-ink">
                      {(c.max_uses ?? 1) > 1
                        ? `${c.use_count ?? 0}/${c.max_uses} used${c.redeemed_at_ms ? ` · last ${fmtTime(c.redeemed_at_ms)}` : ""}`
                        : c.redeemed_at_ms
                          ? `used ${fmtTime(c.redeemed_at_ms)}`
                          : "unused"}
                    </td>
                  </tr>
                ))}
                {codes.length === 0 && (
                  <tr><td className="muted-ink">no codes yet. generate some.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="board-heading">markets (live store)</h2>
          <div className="card admin-table-card">
            <table className="table">
              <tbody>
                {(overview?.markets ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>@{m.author_a_handle} vs @{m.author_b_handle}</td>
                    <td className="muted-ink">{m.status}{m.winner ? ` · ${m.winner}` : ""}</td>
                    <td className="muted-ink">{fmtTime(m.created_at_ms)}</td>
                  </tr>
                ))}
                {(overview?.markets ?? []).length === 0 && (
                  <tr><td className="muted-ink">no markets yet. the bot has not opened one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <button className="gate-btn admin-refresh" onClick={() => void refresh()}>refresh</button>
        </section>
      </div>
    </main>
  );
}
