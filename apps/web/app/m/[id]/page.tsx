"use client";

/**
 * Market page: one market, one URL, forever. The most important page on
 * the site — every shared link opens here, usually for a stranger.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { MarketStrip } from "@ratio/ui";

import { marketById, tradesByMarket } from "../../../lib/fixtures";
import { useMounted } from "../../../lib/useMounted";

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function MarketPage() {
  const mounted = useMounted();
  const params = useParams<{ id: string }>();
  const [explainerOpen, setExplainerOpen] = useState(true);
  if (!mounted) return null;

  const market = marketById(params.id);
  if (!market) {
    return (
      <main className="page">
        <p className="page-empty">no market here. <Link href="/">back to the feed</Link></p>
      </main>
    );
  }
  const { data } = market;
  const trades = (tradesByMarket[data.marketId] ?? []).sort((x, y) => y.amountUsd - x.amountUsd);
  const recipients = [
    { label: `@${data.a.handle}`, note: "the original" },
    { label: `@${data.b.handle}`, note: "the reply" },
    { label: `@${market.taggerHandle}`, note: "tagged it" },
    { label: "ratio", note: "treasury" },
    { label: "doppler", note: "protocol" },
  ];

  return (
    <main className="page">
      {explainerOpen && (
        <div className="card explainer">
          <p>
            two tweets, one clock. anyone can stake on either person, and
            whichever tweet has more likes when the clock runs out wins the
            money. staking early pays better than piling on late.
          </p>
          <button className="explainer-dismiss" onClick={() => setExplainerOpen(false)}>
            got it
          </button>
        </div>
      )}

      <MarketStrip
        data={data}
        fullText
        onSign={(side, amount) => console.log(`sign: $${amount} backing ${side}`)}
      />

      <section className="card">
        <h2>the chart</h2>
        <p className="muted">
          likes as two lines, money as bars under them, from open to now.
          lands with trade-history wiring; every stake is already being
          recorded with amount, tokens, and timestamp so this chart can be
          rebuilt from day one.
        </p>
      </section>

      <section className="card">
        <h2>who is in</h2>
        {trades.length === 0 ? (
          <p className="muted">nobody yet. first money sets the tone.</p>
        ) : (
          <table className="table">
            <tbody>
              {trades.map((t) => (
                <tr key={t.handle + t.amountUsd}>
                  <td>
                    <Link href={`/${t.handle}`}>@{t.handle}</Link>
                  </td>
                  <td className="muted">
                    on @{t.side === "a" ? data.a.handle : data.b.handle}
                  </td>
                  <td className="num">{fmtUsd(t.amountUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>where the fees go</h2>
        <p className="muted">1.25% on every trade, split five ways:</p>
        <table className="table">
          <tbody>
            {recipients.map((r) => (
              <tr key={r.label}>
                <td>
                  {r.label.startsWith("@") ? (
                    <Link href={`/${r.label.slice(1)}`}>{r.label}</Link>
                  ) : (
                    r.label
                  )}
                </td>
                <td className="muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="page-empty">
        <Link href={`/p/${market.postId}`}>all markets on this post</Link>
      </p>
    </main>
  );
}
