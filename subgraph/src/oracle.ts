import { Address, BigInt } from "@graphprotocol/graph-ts";

import {
  EntryTokensSet,
  MarketOpened,
  RatioResolved,
} from "../generated/templates/RatioOracle/RatioOracle";
import { Market } from "../generated/schema";
import { ZERO, protocol, user } from "./shared";

/**
 * The oracle's own account of which tweet it is about.
 *
 * The factory already created this entity from `OracleCreated` — it has to,
 * because this handler lives on a dynamic data source and does not run for the
 * block the source was created in, which is the block this event is emitted
 * in. So this is a reconciliation, not a creation: it fills the entity in if
 * the factory somehow did not, and otherwise confirms what is already there.
 * Both events carry the same marketId and settlesAt, from the same call.
 */
export function handleMarketOpened(event: MarketOpened): void {
  let m = Market.load(event.params.oracle);
  if (m != null) {
    m.marketId = event.params.marketId;
    m.settlesAt = event.params.settlesAt;
    m.save();
    return;
  }

  m = new Market(event.params.oracle);
  m.marketId = event.params.marketId;
  m.settlesAt = event.params.settlesAt;
  m.createdAtBlock = event.block.number;
  m.createdAtTime = event.block.timestamp;
  m.totalStaked = ZERO;
  m.netStaked = ZERO;
  m.tradeCount = 0;
  m.resolved = false;
  m.forfeit = false;
  m.totalPot = ZERO;
  m.totalClaimed = ZERO;
  m.save();

  const p = protocol();
  p.marketCount = p.marketCount + 1;
  p.save();
}

/** Tokens attach after both Airlock creates land, so this is a second step. */
export function handleEntryTokensSet(event: EntryTokensSet): void {
  // Entries are created by the migrator's EntryRegistered, which fires first.
  // Nothing to do here beyond existing as a signal that the market is armed.
}

/**
 * The likes verdict, on chain. The migrator ignores this — it reads getWinner
 * — but it is what lets the subgraph show WHY a market ended without anyone
 * having to trust our database.
 */
export function handleRatioResolved(event: RatioResolved): void {
  const m = Market.load(event.params.oracle);
  if (m == null) return;
  m.resolved = true;
  m.winnerSide = event.params.winnerSide;
  m.likesA = event.params.likesA;
  m.likesB = event.params.likesB;
  m.forfeit = event.params.forfeit;
  m.resolvedAtTime = event.block.timestamp;
  m.save();

  /**
   * Everyone's record, booked at the one moment it becomes true.
   *
   * A loss realises here rather than at claim, because a loser has nothing to
   * claim and would otherwise never realise anything at all — which is how
   * "profit" quietly turns into "money not yet given back". Winners realise
   * when they claim, net of what the position cost.
   *
   * A holder of both sides takes one win and one loss, which is correct: they
   * made two bets.
   */
  const positions = m.positions.load();
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const u = user(Address.fromBytes(pos.bettor));
    if (pos.side == event.params.winnerSide) {
      u.wins = u.wins + 1;
    } else {
      u.losses = u.losses + 1;
      u.realisedProfit = u.realisedProfit.minus(pos.netStaked);
    }
    u.save();
  }
}
