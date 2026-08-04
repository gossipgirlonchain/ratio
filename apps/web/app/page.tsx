"use client";

/**
 * Dev gallery: every state the strip must handle (spec §10), stacked like a
 * post page would stack them — one strip per market, no aggregate anything.
 */
import { MarketStrip, type MarketStripData } from "@ratio/ui";

const NOW = Date.now();
const H = 3_600_000;

const base = {
  settlesAtMs: NOW + 9 * H + 22 * 60_000,
  status: "open" as const,
};

const markets: Array<{ note: string; data: MarketStripData }> = [
  {
    note: "open · money on both sides",
    data: {
      ...base,
      marketId: "m1",
      a: { handle: "bigaccount", likes: 12_400, potUsd: 1_960 },
      b: { handle: "replyguy", likes: 9_800, potUsd: 640 },
      replyText:
        "this is exactly the kind of take that sounds smart until you spend five minutes with the actual numbers, which you clearly have not done, so let me walk you through it",
    },
  },
  {
    note: "open · trailing reply out-liking the original",
    data: {
      ...base,
      marketId: "m2",
      a: { handle: "opinionhaver", likes: 3_100, potUsd: 240 },
      b: { handle: "quietkid", likes: 7_450, potUsd: 380 },
      replyText: "no.",
    },
  },
  {
    note: "open · one side still empty",
    data: {
      ...base,
      marketId: "m3",
      a: { handle: "mainchar", likes: 880, potUsd: 125 },
      b: { handle: "challenger", likes: 610, potUsd: 0 },
      replyText: "brave of you to post this with the chart upside down",
    },
  },
  {
    note: "flagged · reply no longer in thread (display only)",
    data: {
      ...base,
      marketId: "m4",
      a: { handle: "thinskinned", likes: 2_300, potUsd: 410 },
      b: { handle: "hiddenreply", likes: 4_100, potUsd: 890 },
      replyText: "screenshotting this before it disappears, which it will",
      hiddenFromThread: true,
    },
  },
  {
    note: "settled",
    data: {
      marketId: "m5",
      a: { handle: "bigaccount", likes: 18_200, potUsd: 2_400 },
      b: { handle: "replyguy", likes: 21_900, potUsd: 1_150 },
      replyText: "aged like milk and it has only been six hours",
      settlesAtMs: NOW - 2 * H,
      status: "settled",
      winner: "b",
    },
  },
  {
    note: "voided",
    data: {
      marketId: "m6",
      a: { handle: "deleter", likes: 950, potUsd: 75 },
      b: { handle: "witness", likes: 430, potUsd: 40 },
      replyText: "he is absolutely going to delete this",
      settlesAtMs: NOW - H,
      status: "voided",
    },
  },
];

const TICKER =
  "the likes are the referee · every reply is a market · tag it and find out · ";

export default function Page() {
  return (
    <>
      <div className="ticker" aria-hidden>
        <div className="ticker-track">{TICKER.repeat(6)}</div>
      </div>
      <header className="masthead">
        <span className="wordmark">
          get <em>ratio&apos;d</em>
        </span>
        <span className="tag">the likes are the referee</span>
      </header>
      <main className="timeline">
      <h1>ratio · strip states</h1>
      <div className="host-tweet">
        <span className="h">@bigaccount</span>
        <span className="t">
          the market strip below each state renders exactly as it would under
          this tweet in the timeline
        </span>
      </div>
      {markets.map(({ note, data }) => (
        <div key={data.marketId}>
          <p className="section">{note}</p>
          <MarketStrip
            data={data}
            onSign={(side, amount) =>
              console.log(`sign: $${amount} backing ${side}`)
            }
            onPresetUsed={(p) => console.log(`preset used: ${p}`)}
          />
        </div>
      ))}
      </main>
    </>
  );
}
