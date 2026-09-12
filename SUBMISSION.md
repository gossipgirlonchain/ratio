# ETHOnline 2026 submission

Everything the form asks for, ready to paste. Deadline Sunday 13 September,
12:00pm EDT. Video and the Uniswap form are the two things only a human can do.

## Checklist

- [x] Public repo with continuous history: `github.com/gossipgirlonchain/ratio`
- [x] `README.md` with a judge quickstart, per-partner code pointers, AI attribution
- [x] `WHATS-NEW.md` (continuity track: before vs during)
- [x] `prompts/` (every brief and decision, in order)
- [x] `FEEDBACK.md` (Uniswap Foundation, written as friction was hit)
- [x] Live site with a judge access code: `ratio.wtf`, code `RATIO-ETHG-2026`
- [x] Live subgraph: `https://api.studio.thegraph.com/query/1758972/ratio/version/latest`
- [ ] Demo video, 2 to 4 minutes (script below)
- [ ] Uniswap Foundation Developer Feedback Form submitted
- [ ] ETHGlobal form filled from the text below
- [ ] A fresh open market on Base Sepolia for the recording (`npm run sim:evm:live -w @ratio/agent` with `RATIO_SIM_OPEN_ONLY=1 RATIO_SIM_MARKET_MS=28800000`)

## Form text

**Project name:** ratio

**Tagline (one line):**
Prediction markets on X, settled by likes. Tag the bot on a reply and the two tweets race for 24 hours.

**Short description:**
Someone tweets, someone answers, anyone tags @ratiowtf on the answer. A 24-hour market opens between the two tweets and most likes wins. Entry is priced by a Uniswap v4 curve through Doppler, settlement is token-weighted parimutuel, and every number the product shows is read from The Graph because it exists nowhere else. Log in with X, get a Privy wallet, bet. No connect-wallet button, ever.

**Description (long):**

ratio is a head-to-head prediction market that lives inside X. The mechanic is deliberately small: a tweet and the reply (or quote) that answers it, a 24-hour clock, most likes wins. You cannot open a market on your own post, but you can tag your own reply. The likes are the referee, so there is nothing to argue about at settlement and no oracle question beyond "what do the two counters say".

Under the hood each side of a market is a Uniswap v4 pool created through Doppler's Airlock, with Doppler's PredictionMigrator holding the pot. Entry is curve-priced, so a large stake buys progressively fewer outcome tokens than a small one. That dilution is the whole defence against brigading: there are no stake caps, the curve is the cap. At settlement our oracle contract reports the likes verdict, both pools migrate their proceeds into the pot, and winners claim a token-weighted share.

Fees are 1.25% on entry, split five ways at launch and immutable from then on: the original poster, the replier, the person who tagged the bot, Doppler and the protocol. That means everyone who is ever bet on earns from it, whether or not they have used the product, and their unclaimed balance is the reason to log in.

Everything you see in the product is read from a subgraph. Uniswap v4 is a singleton, the pools drain at migration, and no contract ever records what a position cost, so entry prices, trade history, per-side stake, trending by volume, the fee board and the trader board are all sums over indexed events or they do not exist. The app joins that money to X data from our own store, keyed on the tweet id, and says per market which source answered.

Auth is X login only. The Privy embedded wallet is the only wallet. Placing a bet is a transfer out of a Privy server wallet into a v4 pool, signed for a user who has never seen a seed phrase.

This is a continuity-track entry. ratio existed before the event as a Solana product; the port to EVM, the settlement layer, the subgraph, the curve quotes and the app's move to indexed money are the event work. WHATS-NEW.md keeps the two apart.

**How it's made:**

The EVM port sits behind a MarketChain seam the Solana build already had, so the engine, the X mention loop, the eligibility rules and the 18-scenario sim all carried over and the Solana implementation stays beside the new one.

Doppler's EVM prediction market turned out to be deployed on Base Sepolia but undocumented: it lives on an unmerged PR, is whitelisted against the live Airlock, and had processed zero transactions between February and us. ratio is its first integration. We wrote exactly one contract, RatioOracle, an EIP-1167 clone per market that reports the likes verdict and refuses to report it early or twice, plus a factory salted on the tweet id so the agent can compute an oracle address before deploying it. 29 Foundry tests, including a fork against the live Doppler deployment.

The subgraph indexes Doppler's migrator, the v4 PoolManager's swaps and our oracle template. The hard part was attribution: a Swap event carries the PoolKey hashed, so we index forward, computing each pool's id at registration and recording the reverse lookup. Along the way we found that a dynamic data source does not see events from the block it was created in, which silently dropped one side of a market's money; the market entity is now created from the static factory source instead.

Quotes are simulated on chain rather than derived from pot totals, with a state override on the caller's balance so a $500 quote does not fail on our treasury's balance. The token denominator comes from the index.

Settlement taught us one lesson four times: a confirmed transaction is not a readable one. On a load-balanced RPC, migrate reverted because the oracle it asked had not seen declareWinner, claim reverted because the approve was not visible yet, and a winner was told they were paid $0.00 on a claim that paid them. Every step now confirms by a read, not a receipt, and two audit scripts in the repo are how we found the stranded markets.

Privy server wallets are keyed to the numeric X id with a namespaced idempotency key, one wallet per person per chain, on @privy-io/node. Fee recipients get a wallet at market creation so their fees accrue before they ever log in.

Nearly all the code was written by Claude in Claude Code from written direction; the product, the rules, the fee split and every decision in prompts/ are human. The README says which is which.

**Repo:** https://github.com/gossipgirlonchain/ratio
**Live:** https://ratio.wtf (access code RATIO-ETHG-2026)
**Subgraph:** https://api.studio.thegraph.com/query/1758972/ratio/version/latest
**Contracts (Base Sepolia):** RatioOracleFactory 0xCFeBFF30bf95E9bD5EEBBA7cD6c78c5764d090Dd, PredictionMigrator 0x91aad599EfD70E633d091FC060cc6f9D3e5298BE

## Prize tracks

**The Graph.** The subgraph is the only source of money data in the product: entry prices, trades, per-side stake, trending, both leaderboards, positions. The agent prices its odds from it and the app joins it to X data per market. Endpoint above. Continuity track.

**Uniswap Foundation.** Every market is two Uniswap v4 pools via Doppler hooks; entry pricing is entirely v4. FEEDBACK.md is in the repo, written as friction was hit, including two module-wiring bugs that block any integrator, an undecodable revert selector, and the read-consistency class. Developer Feedback Form: submit separately.

**Privy, best financial flow.** Placing a bet: X login, an embedded server wallet keyed to the X id, a signed transfer into a v4 pool. No connect-wallet, no seed phrase. Not entering the B2B track.

## Video script (2 to 4 minutes)

Record against a live open market. Create one first:

```bash
cd ~/ratio && RATIO_SIM_OPEN_ONLY=1 RATIO_SIM_MARKET_MS=28800000 npm run sim:evm:live -w @ratio/agent
```

It prints the market id. Open `ratio.wtf/m/<id>` (code RATIO-ETHG-2026).

**0:00 to 0:25, the mechanic.** Screen: a real reply thread on X. Voice: "Someone tweets. Someone answers. Anyone tags @ratiowtf on the answer, and the two tweets race for 24 hours. Most likes wins. The likes are the referee."

**0:25 to 0:55, the feed.** Screen: ratio.wtf feed, then the market page. Voice: "This is the market. Two tweets, two like counts, the money on each side. Every number here is read from The Graph, because on chain there are no entry prices and no trade history: v4 is a singleton and the pools drain at settlement. This is the only copy."

**0:55 to 1:35, the bet and the quote.** Screen: tap a side, tap $1, then $25, then $500, watch the quote change. Voice: "Entry is priced by a Uniswap v4 curve through Doppler. A dollar buys more tokens than the five-hundredth dollar. That is the quote moving, simulated on chain for each amount. There are no stake caps, the curve is the cap. Sign, and that is a Privy wallet transferring into a v4 pool. You logged in with X. You have never seen a seed phrase."

**1:35 to 2:15, settlement.** Screen: the terminal running the sim, or the index query from the README. Voice: "At 24 hours our oracle reports the verdict. Both pools migrate into the pot, winners claim a token-weighted share, fees split five ways: the poster, the replier, the tagger, Doppler, the protocol. This market was paid out end to end by the engine on Base Sepolia. Read it straight from the subgraph: total claimed equals the pot."

**2:15 to 2:45, what we found.** Screen: FEEDBACK.md section 1, then WHATS-NEW. Voice: "Doppler's EVM prediction market was deployed on Base Sepolia and documented nowhere. We were its first transaction. The friction is written up as we hit it, including the four times a confirmed transaction was not a readable one."

**2:45 to 3:00, close.** Screen: the fee leaderboard. Voice: "Everyone who gets bet on earns from it, whether they have used ratio or not. Their unclaimed balance is the reason to log in. ratio.wtf."
