"use client";

/**
 * The feed. Strips stacked, scrolls like X. (Signed off as-is: renders the
 * shared fixture set in every state; live data ranks by net staked and
 * drops settled markets when the store lands.)
 */
import { MarketStrip } from "@ratio/ui";

import { markets } from "../lib/fixtures";
import { useMounted } from "../lib/useMounted";

export default function Page() {
  const mounted = useMounted();
  if (!mounted) return null;
  return (
    <>
      <header className="masthead">
        <span className="wordmark">
          get <em>ratio&apos;d</em>
        </span>
        <span className="tag">the likes are the referee</span>
      </header>
      <main className="timeline">
        {markets.map(({ data }) => (
          <div key={data.marketId}>
            <MarketStrip
              data={data}
              onSign={(side, amount) =>
                console.log(`sign: $${amount} backing ${side}`)
              }
              onPresetUsed={(p) => console.log(`preset used: ${p}`)}
              marketHref={`/m/${data.marketId}`}
            />
          </div>
        ))}
      </main>
    </>
  );
}
