"use client";

/**
 * Dev gallery in user-flow order: fresh market -> money arrives -> flagged
 * mid-market -> settled -> voided. Labels are state names, nothing more.
 */
import { MarketStrip, type MarketStripData } from "@ratio/ui";

const NOW = Date.now();
const H = 3_600_000;

const markets: Array<{ note: string; data: MarketStripData }> = [
  {
    note: "just opened",
    data: {
      marketId: "m1",
      a: {
        handle: "mainchar",
        text: "posting my chart. the bottom is in, you can screenshot this",
        likes: 880,
        potUsd: 125,
      },
      b: {
        handle: "challenger",
        text: "brave of you to post this with the chart upside down",
        likes: 610,
        potUsd: 0,
      },
      settlesAtMs: NOW + 23 * H + 12 * 60_000,
      status: "open",
    },
  },
  {
    note: "open",
    data: {
      marketId: "m2",
      a: {
        handle: "bigaccount",
        text: "unpopular opinion but remote work made everyone worse at their jobs and nobody wants to admit it",
        likes: 12_400,
        potUsd: 1_960,
      },
      b: {
        handle: "replyguy",
        text: "this is exactly the kind of take that sounds smart until you spend five minutes with the actual numbers, which you clearly have not done, so let me walk you through it",
        likes: 9_800,
        potUsd: 640,
      },
      settlesAtMs: NOW + 9 * H + 22 * 60_000,
      status: "open",
    },
  },
  {
    note: "open",
    data: {
      marketId: "m3",
      a: { handle: "opinionhaver", text: "cereal is a soup", likes: 3_100, potUsd: 240 },
      b: { handle: "quietkid", text: "no.", likes: 7_450, potUsd: 380 },
      settlesAtMs: NOW + 4 * H + 51 * 60_000,
      status: "open",
    },
  },
  {
    note: "flagged",
    data: {
      marketId: "m4",
      a: {
        handle: "thinskinned",
        text: "criticism of my product is just engagement farming at this point",
        likes: 2_300,
        potUsd: 410,
      },
      b: {
        handle: "hiddenreply",
        text: "screenshotting this before it disappears, which it will",
        likes: 4_100,
        potUsd: 890,
      },
      settlesAtMs: NOW + 6 * H,
      status: "open",
      hiddenFromThread: true,
    },
  },
  {
    note: "settled",
    data: {
      marketId: "m5",
      a: {
        handle: "bigaccount",
        text: "nobody under 30 can name three Beatles songs",
        likes: 18_200,
        potUsd: 2_400,
      },
      b: {
        handle: "replyguy",
        text: "aged like milk and it has only been six hours",
        likes: 21_900,
        potUsd: 1_150,
      },
      settlesAtMs: NOW - 2 * H,
      status: "settled",
      winner: "b",
    },
  },
  {
    note: "voided",
    data: {
      marketId: "m6",
      a: { handle: "deleter", text: "watch me say it anyway", likes: 950, potUsd: 75 },
      b: { handle: "witness", text: "he is absolutely going to delete this", likes: 430, potUsd: 40 },
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
