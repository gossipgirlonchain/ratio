import { BigInt } from "@graphprotocol/graph-ts";

import {
  EntryTokensSet,
  MarketOpened,
  RatioResolved,
} from "../generated/templates/RatioOracle/RatioOracle";
import { Market } from "../generated/schema";
import { ZERO, protocol } from "./shared";

/**
 * The only place the chain records which tweet a market is about. Doppler's
 * migrator has no concept of a tweet, so without this the money could never be
 * joined to the thing it is about.
 */
export function handleMarketOpened(event: MarketOpened): void {
  const m = new Market(event.params.oracle);
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
}
