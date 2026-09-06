# 00 — EVM port brief

**Given: 2026-09-06 (Sunday).** The opening brief for ETHGlobal ETHOnline 2026.
Submissions due Sunday 13 September, 12:00pm EDT.

---

We are porting ratio to EVM for ETHGlobal ETHOnline 2026. Repo:
`github.com/gossipgirlonchain/ratio`. Submissions are due Sunday 13 September,
12:00pm EDT. Today is Sunday 6 September. That is seven days including today.

## Do this first, and stop

Do not write or edit any code until you have finished this step and I have replied.
Read the repo and report back with:

1. The package/workspace layout and what each part does.
2. The `MarketChain` abstraction. There is a chain-abstraction seam here from the
   Solana work (`packages/doppler` sits behind it). Show me its full interface,
   every implementation of it, and every place the rest of the codebase reaches
   around it and touches Solana directly. That last list is the actual size of
   this job.
3. The agent's three swappable seams — `XClient`, `WalletProvider`, `Store` —
   their interfaces and their current implementations.
4. Where market state lives, and what is read from chain versus from our own store.
5. The existing test suite: what is covered, what runs without a live chain.
6. `PLAN.md` and any other planning docs, and how far the code has diverged from them.

Then give me a written port plan with a file-by-file diff estimate and the three
riskiest unknowns. Wait for my go-ahead before touching anything.

## What we are building

Ratio, unchanged in behaviour, running on EVM instead of Solana.

Recall the mechanic so you do not redesign it: anyone tags `@ratio` on a tweet
less than 12 hours old. A head-to-head market opens between that tweet and the
tweet it replies to (or quotes). The subject is the single top reply by likes,
not an aggregate and not a scout's pick. Most likes at 24 hours wins. You cannot
open a market on your own post, but you can tag your own reply.

Settled decisions. Do not relitigate these.

* Auth is X login only. The Privy embedded wallet is the only wallet. There is no
  connect-wallet button, no Phantom, no WalletConnect, no external wallet of any
  kind, ever. Users fund by transferring in. If you find yourself adding a wallet
  connector, stop and ask.
* Markets are a hybrid, not plain parimutuel. Entry is curve-priced (XYK,
  `allowSell` true), so tokens-per-dollar falls as a side's raise grows.
  Settlement is token-weighted parimutuel: `payout = yourTokens / claimableSupply
  * netPot`, where `netPot = gross * 0.9875`.
* Quotes must come from on-chain `previewSwapExactIn` to get `tokensOut`, then
  take the token share of the projected pot. The linear pot-split formula is only
  the small-stake limit and it overquotes large stakes. If you find that formula
  anywhere, it is a bug.
* A market must void if the winning side has no money on it. On-chain migration
  throws `ZeroClaimableSupply` otherwise. This guard is required, not optional.
* Ties and deleted tweets void and refund.
* Holders can sell out of an open market back into the curve. Exits are
  path-dependent.
* Fees split five ways. Trending ranks by staked volume, not market count.
* Duplicate pairs are rejected with an apology and a link to the existing market.
* Failures are classified transient versus permanent: rate limits and 5xx defer,
  they do not void.
* No token launch for this product.

## The port

Doppler is EVM-native. The Solana build was the port, not the original, so this is
going back to Doppler's home turf. Two consequences to verify rather than assume:

1. Uniswap v4 hooks are how Doppler works on EVM. Find Doppler's current EVM
   contracts and confirm which chains they are deployed on. Prefer a testnet where
   Doppler is actually live. If Doppler is on Unichain, use Unichain Sepolia,
   because Uniswap Foundation is one of our three prize partners and that will read
   well. Otherwise Base Sepolia. Tell me which and why before you commit to it.
2. The five-beneficiary fee cap was a Solana transaction-size limit. On EVM the
   rehypothecation hook may lift it. Check. If it does, note it, but keep the split
   at five for this build — changing the economics mid-port is not what this week
   is for.

Work behind `MarketChain`. Add an EVM implementation next to the Solana one; do not
delete Solana. Every place the codebase reaches around `MarketChain` to touch Solana
directly is a thing to lift behind the interface first, as its own commit, before
any EVM code lands.

## Three prize integrations

We can enter three partners. These are chosen; do not add a fourth.

**The Graph ($15,000, the biggest pool).** We need a subgraph regardless of the
prize: on-chain there are no entry prices and no trade history, so time series,
trending by staked volume, and the fee leaderboard all have to come from indexed
events. Build it properly. Their brief rewards composing two or more Graph products
or building on standardised schemas, so look at what those are and use them rather
than rolling a bespoke schema. There is a continuity track we qualify for.
Deliverables: public repo, README, 2-4 minute demo video.

**Uniswap Foundation ($5,000).** Doppler markets are v4 hooks, so we qualify
structurally. Both their tracks are open to us. Two hard deliverables beyond the
code: a `FEEDBACK.md` in the repo, and their Developer Feedback Form submitted.
Neither is optional and both are cheap. Write FEEDBACK.md as you go, from real
friction you hit, not at the end.

**Privy ($5,000, two tracks).** X login to embedded wallet is already our
architecture. Use `@privy-io/react-auth` on the client and `@privy-io/node` on the
server. Do not use `@privy-io/server-auth`, it is deprecated and it is the most
common stale-tutorial trap in their ecosystem right now. Their "best financial
flow" track wants one real financial flow: placing a bet is a transfer out of a
Privy wallet, so that is the claim. Their B2B track wants a Privy control
(policies, signers, key quorums) plus a business workflow; judge whether we have an
honest claim there and tell me, do not force one.

## Do not build these

Cutting these is deliberate. If you think one is necessary, say so and wait.

* The Chrome extension. It is the best part of the product and it demos badly on video.
* The PWA.
* The exit-fee ramp (1.25% for 12 hours then ramping to 75%). Ship the flat on-chain floor.
* Any standalone marketing site.
* Hide detection and forfeit. Already out of v1.

## The spine to have working end to end

1. A scout tags `@ratio` on a qualifying tweet, the bot opens a market.
2. A user logs in with X, gets a Privy wallet, funds it, places a bet.
3. Likes at 24 hours settle it, winners claim, fees split five ways.
4. The subgraph feeds a trending view ranked by staked volume and a fee leaderboard.
5. The void guard fires correctly when the winning side is empty.

Everything else is optional.

## How to work

* Commit continuously, in small pieces. ETHGlobal checks version control history and
  says large single commits or a missing history may be disqualified. Do not squash.
* We are entering the continuity track, so keep a running `WHATS-NEW.md` with two
  lists: what existed before 4 September, and what was built during the event. Only
  the new work is judged, so undersell nothing and overclaim nothing.
* Keep every prompt and planning file in `prompts/`. The rules require spec files and
  prompts in the submission repo and you cannot reconstruct them on Saturday.
* Attribute AI-written code per file in the README.
* Tests before UI. The settlement maths is the part that must be right; a broken payout
  calculation behind a beautiful feed is worth nothing.
* Ask before any dependency upgrade, any schema change, or anything that touches the
  settled decisions above.
* If something in this brief contradicts what you find in the code, the code wins as
  evidence and you tell me, rather than picking one silently.

Start with the recon step and report back.
