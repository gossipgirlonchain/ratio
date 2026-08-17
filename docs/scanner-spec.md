# Market scanner — spec

**Status: BUILT (fixture version, winny pulled it forward 2026-08-14) —
the in-app panel, parser, evaluator, and instrumentation are live in
apps/web (lib/scanner.ts + components/ScannerPanel.tsx). Still pending:
server-side evaluation next to the real likes sampler, extension push,
and Telegram delivery — those land with their own workstreams.**
Spec'd 2026-08-13 from winny's trading-product teardown follow-up.

Alerts only, **no auto-trading**. Users set standing rules and get notified
when a live market matches. They still place the bet themselves.

## Conditions (combinable with AND)

- Like gap between the sides, as a ratio or absolute (e.g. within 10%, or
  side B leading by 2:1)
- Absolute like count on either side, above or below a threshold
- Total staked, above or below
- Money imbalance between the sides
- Time remaining, above or below
- Either account is in a watchlist of handles
- Market type: reply, quote tweet, or both

## Evaluation

- Same cadence as the likes sampler (`LIKES_SAMPLE_INTERVAL_MS`) — that is
  when the data changes.
- Fire ONCE per rule per market. No repeat alerts as a market keeps
  matching.

## Delivery channels

In-app, browser push via the extension, and Telegram if linked. Every
alert leads with the market and a direct way to act (deep link to
`/m/[id]`), never a bare notification.

## UI (revised 2026-08-14: KNOBS, not chat — winny reversed the chat
design after seeing it: "it needs to be knobs, not qualitative")

**A persistent panel in the right rail, under the leaderboard.** That
space is empty on every page.

- Persists across ALL pages and holds its state during navigation —
  mount it in the layout shell, not per-page, or state dies on route
  change. (Note: market pages currently have their own rail with the
  trade panel; the scanner panel sits under whatever the page's rail
  holds, one shared component.)
- Collapsible; remembers whether it's open (localStorage, like the
  sidebar collapse).
- **Knobs.** One row per condition: an explicit mode select + number
  (like gap: any / within % / within likes / leader >= x:1; likes and
  staked: any / over / under; imbalance: any / >= x times; time left:
  any / under / over + h/m; handles: free @list; type: both / replies /
  quotes). A generated summary line shows exactly what the rule means
  before saving; nothing qualitative, nothing parsed from prose.
- The panel is builder AND manager: it lists active rules with a match
  count on each, and alerts appear in the same panel as they fire — each
  leading with the market and a direct way to bet. Once a rule is saved
  the builder MINIMISES behind a "+ new rule" button: the panel's job
  becomes showing results, not the form. Time-left wording is always
  "ends in", never "closing" (word-family collision with the old
  "close markets" label).
- Presets are concrete knob settings — one tap fills the controls, the
  user still reviews and saves. Always visible (not just the empty
  state), each one a thesis:
  - "neck and neck over 5k likes" (gap within 15% + likes over 5k;
    renamed from "close markets" — close-the-adjective next to a time
    condition reads as close-the-verb)
  - "one side barely funded" (money 5x lopsided)
  - "final hour" (time left under 1h)
  - "big fight, tiny pot" (likes over 10k + staked under $200)
  - "photo finish" (gap within 5% + closing under 2h)
  - "whale market" (staked over $2,000)
  - "first money in" (staked under $50)
  - "fresh with heat" (over 20h left + likes over 2k)
  - "quote tweet beef" (quote tweets only)
- Logged out: panel shows with presets visible; saving a rule prompts
  log in (point-of-action gate, same as everywhere else).

## Instrumentation (load-bearing)

Track: rules created, alerts fired, and **alerts that led to a bet**.
That last number decides whether an auto-trading version is ever worth
building.

## Explicitly out of scope

**No auto-execution.** Placing bets on someone's behalf while they're
away means signing from their Privy wallet unattended — a different
regulatory and terms position that needs the Privy policy engine
configured properly. If the scanner shows real usage, auto-trading gets
revisited as its own piece of work. Do not slip it in here.
