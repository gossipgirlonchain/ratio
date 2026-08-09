# ratio

A Solana prediction market that lives on X. Someone tweets, someone answers,
anyone tags the bot on the answer: a 24-hour market opens between the two
tweets. Most likes when the clock runs out wins. The likes are the referee.

Rebuild of `cue-wire` (different mechanic, same seams). `ratio.wtf`; the X
handle is unregistered — `BOT_HANDLE` in `@ratio/config` drives it everywhere.

## Status

- **R1 — done.** Eligibility gate, pair resolution (QT + reply, one code
  path), market creation, 24h settlement on absolute like counts, tie to
  side A, mid-window health check, ZeroClaimableSupply void guard. All
  against mocks: `npm run sim`.
- **R2 — done.** Mid-window health check, transient-vs-gone distinction
  (API failures defer and retry; only definitive unreadability voids). No
  forfeit; `forfeited` stays reserved in the schema.
- **Hidden-reply badge — done (agent side).** The extension reports side B
  missing from its thread; at `HIDDEN_REPORT_THRESHOLD` independent
  reporters the badge goes live and the bot posts once ("this reply is no
  longer showing in the thread. the market is still open."). Display flag
  ONLY — settlement stays pure like counts. Observation-worded, never names
  the hider. This is a feature, not an error state: the market page and
  extension surface hidden markets prominently (R5), routing likes to the
  suppressed reply. It is also the extension's install driver — the
  extension is the only thing that can see a hide.
- **Folded ahead of R3 (2026-07-31):** fees locked (1.25% swap fee, five
  immutable beneficiaries: doppler 7.5 / treasury 45 / A 18 / B 18 / tagger
  11.5); own-post rule (tagger can never be side A's author; tagger as side
  B's author is allowed and stacks slices); duplicate pairs convert with a
  direct market link instead of a bare rejection; post view indexed on
  `tweet_a_id` with a HARD no-cross-market-aggregation rule (count is a
  count, never a score); trending ranks on staked volume, never market
  count. Odds displays derive from pot shares (no continuous curve price in
  a parimutuel market).
- **R3 — devnet lifecycle PROVEN (2026-07-31).** `@ratio/doppler`
  (`RatioMarketClient`, doppler-sdk 1.0.34): oracle + A/B curves with FIVE
  fee beneficiaries at the locked split → stakes both sides → finalize(A)
  → migrate → claim. Pot = staked − 1.25% exactly (0.1086 of 0.11 SOL),
  winner multiple 1.358x.
- **R3 tail — engine on the real chain (2026-08-03).** `sim:devnet` runs
  the actual `RatioEngine` (fake X) against `DopplerMarketChain` +
  `LocalWalletProvider` (Privy stand-in behind the same seam): mention →
  five-beneficiary launch → two real reply-stake swaps → finalize →
  migrate, all through the engine's own code path. Accounting fact learned:
  the pre-migration odds snapshot (quote vaults) is GROSS staked volume;
  the fee is realized at migration, so claimable pot = snapshot − 1.25%.
  Display and fee-card code must not conflate the two. Mock tweet ids are
  wall-clock-seeded in the devnet sim (ids become oracle nonces; reused
  nonces collide with prior runs' PDAs).
- **UI spec landed (2026-08-03); strip v2 after winny's review.**
  `packages/ui` MarketStrip = the canonical component (extension strip is
  the reference; app mirrors it via host variables + `apps/web` skin.css —
  never fork the component for a skin). v2 layout: both tweets are sibling
  rows with identical treatment (the OP is a competitor, not context);
  like counts 13px at the right of each row; the leader is a shaded row
  with a bold count and nothing else; zero ? hints; ONE line of copy
  ("most likes in <time> wins" / "@x won" / "voided · stakes refunded");
  12-13px throughout; tap a row to back someone; the amount grid appears
  only after a pick, swapping with the whole body in one grid cell (no
  reserved dead space, height provably constant). One strip one market (no
  aggregate state, ever); money demoted below the divider as pot shares;
  no status vocabulary anywhere; parimutuel quote with dilution surfaced
  (payout.ts documents the spec-example discrepancy + the plan to quote
  from the chain's preview swap); hidden badge is a story beat and the
  market stays bettable. Funding (§11) goes behind FundingProvider in R4.
- **Reply surface is §4-clean (2026-08-03).** Stakes are handle-based
  ("$25 @handle", "@handle $25", "$25 on @handle"); A/B letters remain a
  silent parser fallback. Unresolvable handles fail safe (skip, no reply
  spend). Bot confirms and recaps name people, never sides. Also landed:
  `feeLeaderboard` store query (one combined board ranked on total fees,
  per-role breakdown per row, rolling windows keyed on bet timestamps) and
  the `FundingMethod` seam (`@ratio/config/funding`).
- **Site architecture specced (2026-08-03, R5 scope)** — see winny's doc.
  Store hardened NOW so the schema can carry it: trade records gained
  `direction` (buy/sell — the chart's only time series, unbackfillable),
  plus `listMarketsByParticipant` (profiles exist for every account that
  ever touched a market, no opt-out), `listMarketsByVolume` (feed ranks by
  windowed staked volume; settled markets drop off), and
  `openPositionsByUser` (net of sells; average entry only exists in our
  records). Key page decisions: profile IS the claim page (no separate
  dashboard, public unclaimed balances are the acquisition hook); exits
  live on the market page only, never the extension strip; extension
  collapsed bar shows count + volume ONLY (no aggregate outcome state);
  posts without markets get a hover-only create preview in X's action
  row; OG unfurl images are their own workstream sharing infra with
  settlement fee cards.
- **R4.** Privy server wallets keyed on numeric X id, ATA creation in the
  sponsored-gas path, unclaimed-fee notifications.
- **R5.** PWA -> extension -> Telegram.

## Layout

- `apps/agent` — mention loop, engine, settlement + health-check crons, sim
- `packages/config` — every knob and every copy template (handle-parameterized)
- `packages/doppler` — `RatioMarketClient` on doppler-sol (prediction
  migrator); `npm run e2e -w @ratio/doppler` runs the devnet lifecycle

Seams (all swappable, engine never knows): `XClient`, `WalletProvider`,
`Store`, `MarketChain`.
