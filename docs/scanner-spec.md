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

## UI

- Rule builder on the profile.
- List of active rules with a match count against each.
- Two or three preset rules so nobody faces an empty builder:
  - "close markets over 5k likes"
  - "one side barely funded"
  - "closing in under an hour"

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
