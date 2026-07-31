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
- **R3 — next.** Prediction migrator confirmed as the settlement path;
  five feeBeneficiaries per curve (hard cap), weights immutable at creation:
  Doppler 7.5 / treasury 45 / side A 18 / side B 18 / tagger 11.5. Port
  cue-wire `packages/doppler` behind `MarketChain`.
- **R4.** Privy server wallets keyed on numeric X id, ATA creation in the
  sponsored-gas path, unclaimed-fee notifications.
- **R5.** PWA -> extension -> Telegram.

## Layout

- `apps/agent` — mention loop, engine, settlement + health-check crons, sim
- `packages/config` — every knob and every copy template (handle-parameterized)

Seams (all swappable, engine never knows): `XClient`, `WalletProvider`,
`Store`, `MarketChain`.
