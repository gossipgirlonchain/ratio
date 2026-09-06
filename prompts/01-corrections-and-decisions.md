# 01 — Corrections and decisions

**Given: 2026-09-06 (Sunday), in response to the recon report.**

This is the message that unblocked the build. It settles unknown 1 (we write the
settlement layer), reorders the week around the event schema, and corrects four
places where `00-evm-port-brief.md` was wrong and the code was right.

---

Excellent recon. Four things in my original brief were wrong and your reading of the
code wins on all of them. Corrections and decisions below. Go ahead after you have
read this.

## Unknown 1: we write the settlement layer. Option (a).

Doppler handles entry pricing. We own resolution and payout. Not option (c) — an
off-chain treasury payout is a worse product and it looks like a dodge on video.

Three reasons this is smaller than it looks:

1. **It is a well-trodden contract.** Escrow both curves' quote proceeds,
   `finalize(winner)` gated on a trusted oracle address, `claim()` paying
   `yourTokens / claimableSupply * netPot`. That is roughly 200 lines plus Foundry
   tests, not a research project.
2. **It kills unknown 2 for free.** `tokens_out = 0` exists because nothing captures
   the post-swap balance. If our contract is the thing that records the position, we
   know the token count by construction. Risk 1 and risk 2 collapse into one piece of
   work rather than two.
3. **It is the better story.** "Doppler's prediction lifecycle is Solana-only, so we
   wrote the EVM settlement layer" is a real contribution, and it is exactly what
   Uniswap Foundation's stack-contribution track is asking for. Write it as if you
   intend to hand it to the Doppler team, because we might.

Keep the trusted-oracle model. The agent is the oracle, same as Solana. Do not invent
a decentralised resolution scheme this week.

**Before you write any Solidity, stop and tell me.** Winny is messaging Austin at
Doppler to confirm there is no EVM prediction module in flight. If there is one
unreleased, the week is a port and not a port plus a contract. That answer is worth
waiting a few hours for.

## Reordering: freeze the event schema on day one

The Graph is our biggest prize at $15,000 and the subgraph cannot start until events
exist. If the contract slips, the subgraph slips, and the largest prize dies with it.

So: **design and freeze the contract's event schema before you write the contract
body.** Publish it as `contracts/EVENTS.md`. Once it is frozen, subgraph work and
contract work run in parallel and neither blocks the other. Treat a change to that
schema after Tuesday as something you ask me about first.

## The other two unknowns

**Privy wallets: do not migrate. Namespace instead.** Use a new idempotency key,
`ratio-evm-wallet-${xUserId}`, and create fresh `chain_type: "ethereum"` wallets. The
existing Solana wallets hold devnet funds and nothing of value. Migration is where the
collide-two-users-into-one-wallet bug lives, so we simply do not do it. And yes, move
to `@privy-io/node`; `@privy-io/server-auth` has been deprecated for nearly a year.

**Chain: Base Sepolia, agreed.** Your reasoning is right and the Uniswap claim is
structural, not chain-specific. Stop looking for a Unichain deployment.

## Where my brief was wrong. Code wins.

- **Sells.** I said holders can sell out and exits are path-dependent.
  `SELLS_ENABLED = false` is correct and it is a protocol constraint the Doppler team
  confirmed. Our own settlement contract could make sells possible on EVM. **Do not do
  it this week.** Note it in FEEDBACK.md as a thing the EVM path unlocks.
- **Voids.** I said ties, deletions and empty winning sides void and refund. They do
  not, and the $1-per-side treasury seed plus forfeit-to-survivor is the current
  design. Keep it. Do not re-add `voided` status. Series 5's void work is cut.
- **The linear formula.** Here my brief was right and the code is wrong. `payout.ts`
  is the overquoting formula and it is the live quote path. Replace it, and rewrite
  its test, which currently asserts the wrong answer as correct. This gets cheaper
  once our contract knows real token counts.
- **Five beneficiaries.** Four when the tagger is also side B's author, because
  duplicates get merged. That is correct behaviour. Say "up to five" in the write-up
  rather than "five".

## Cuts

- **Delete `apps/teaser` from the workspace.** 1,100 lines of mock-data marketing site
  with no shared dependencies. It is pure drag on typecheck and attention.
- **Privy's B2B track: we are not entering it.** You asked me to judge and the answer
  is no. Ratio has no honest business-workflow or treasury-control claim, and forcing
  one scores worse than not entering. We enter Privy's "best financial flow" only,
  with placing a bet as the claim.
- **Leave the scanner panel exactly as it is.** Do not extend it, do not remove it.
- Exit-fee ramp stays cut.

## Sequence

Today is Sunday 6 September. Code freeze is Saturday 12 September; Sunday is
submission and buffer only.

| Day | Work |
|---|---|
| **Sun 6** | Series 1 reach-arounds. Event schema frozen and written to `contracts/EVENTS.md`. Sim green after every commit. |
| **Mon 7** | Series 1 finished. Contract skeleton and Foundry tests. Subgraph scaffolding starts against the frozen schema. |
| **Tue 8** | Settlement contract done and tested. EVM `MarketChain` implementation. |
| **Wed 9** | One market end to end on Base Sepolia: create, bet, finalize, claim. This is the day that decides whether we ship. |
| **Thu 10** | Quote correctness and real `tokens_out`. Privy EVM wallets. |
| **Fri 11** | Subgraph wired into trending, leaderboard, market page. |
| **Sat 12** | `FEEDBACK.md`, `WHATS-NEW.md`, `prompts/`, README AI attribution, record the video. |
| **Sun 13** | Submit by 12:00pm EDT. |

If Wednesday ends without a market settling end to end on Base Sepolia, tell me that
night rather than pushing on. That is the decision point, not Friday.

## Standing rules

- Sim stays green after every commit in Series 1. It is the only safety net we have.
- Commit continuously and small. ETHGlobal disqualifies for missing or lumpy history.
- `FEEDBACK.md` gets written as you hit friction, not on Saturday. Same for `prompts/`.
- The settlement maths is the one thing that must be right. Tests before UI, always.
- If the code contradicts anything I have said above, the code wins and you tell me.

Start with Series 1 and the event schema. Hold on Solidity until I confirm the Doppler
answer.
