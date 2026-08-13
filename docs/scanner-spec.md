# Market scanner — spec (backlog)

**Status: backlog, not launch. Land AFTER the extension and the OG images.**
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

## UI (revised 2026-08-13: chat panel, not a profile form)

**A persistent panel in the right rail, under the leaderboard.** That
space is empty on every page.

- Persists across ALL pages and holds its state during navigation —
  mount it in the layout shell, not per-page, or state dies on route
  change. (Note: market pages currently have their own rail with the
  trade panel; the scanner panel sits under whatever the page's rail
  holds, one shared component.)
- Collapsible; remembers whether it's open (localStorage, like the
  sidebar collapse).
- **It works like a chat.** Users describe what they want in plain
  English ("tell me when a market is neck and neck with over 5k likes",
  "alert me on anything involving @bigaccount"); it parses that into a
  rule, shows the rule back for confirmation, and saves it. Chat rather
  than a form because the point is people not having to learn what
  conditions exist.
- Failure handling: if the intent is unclear, ask ONE clarifying
  question. Never guess.
- The panel is builder AND manager: it lists active rules with a match
  count on each, and alerts appear in the same panel as they fire — each
  leading with the market and a direct way to bet.
- Empty state: two or three preset rules as suggested prompts, never a
  blank box:
  - "close markets over 5k likes"
  - "one side barely funded"
  - "closing in under an hour"
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
