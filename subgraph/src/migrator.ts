import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

import {
  Claimed,
  EntryMigrated,
  EntryRegistered,
} from "../generated/PredictionMigrator/PredictionMigrator";
import { Claim, Entry, Market, Pool, Position } from "../generated/schema";
import { ZERO, entryId, poolIdFor, positionId, protocol, user } from "./shared";

/** The initializer the pools are created under; part of every PoolKey. */
const HOOK_INITIALIZER = Address.fromString(
  "0xAA096F558f3d4c9226De77E7Cc05f18E180B2544",
);

/**
 * A side registers. entryId is the side index, because the migrator only
 * requires uniqueness within a market.
 */
export function handleEntryRegistered(event: EntryRegistered): void {
  const market = Market.load(event.params.oracle);
  if (market == null) return; // not one of ours

  const side = event.params.entryId.toI32();
  const id = entryId(event.params.oracle, side);

  const e = new Entry(id);
  e.market = market.id;
  e.side = side;
  e.token = event.params.token;
  e.numeraire = event.params.numeraire;
  e.staked = ZERO;
  e.tradeCount = 0;
  e.migrated = false;
  e.contribution = ZERO;
  e.claimableSupply = ZERO;

  // Compute the pool this entry's swaps will land in, and record the reverse
  // lookup NOW — the Swap event only carries a poolId, and the PoolKey that
  // would identify the token arrives hashed.
  const pid = poolIdFor(Address.fromBytes(event.params.token), HOOK_INITIALIZER);
  e.poolId = pid;
  e.save();

  const pool = new Pool(pid);
  pool.entry = e.id;
  pool.market = market.id;
  pool.save();
}

/**
 * Proceeds move into the pot and the payout denominator is fixed. Claims
 * revert until the WINNING entry has migrated, so this is the gate.
 */
export function handleEntryMigrated(event: EntryMigrated): void {
  const side = event.params.entryId.toI32();
  const e = Entry.load(entryId(event.params.oracle, side));
  if (e == null) return;

  e.migrated = true;
  e.contribution = event.params.contribution;
  e.claimableSupply = event.params.claimableSupply;
  e.save();

  const m = Market.load(event.params.oracle);
  if (m == null) return;
  m.totalPot = m.totalPot.plus(event.params.contribution);
  // Guard on `resolved`, NOT on winnerSide != null. graph-codegen makes a
  // nullable Int a plain i32 that returns 0 when unset, so a null check is
  // always true and an unresolved market reads as "side A won" — which would
  // stamp side A's token as the winner on the first migration.
  if (m.resolved && m.winnerSide == side) m.winningToken = e.token;
  m.save();
}

/** A winner burned their position for a share of the pot. */
export function handleClaimed(event: Claimed): void {
  const m = Market.load(event.params.oracle);
  if (m == null) return;

  const c = new Claim(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  );
  c.market = m.id;
  c.claimer = event.params.claimer;
  c.user = event.params.claimer;
  c.tokensBurned = event.params.tokensBurned;
  c.payout = event.params.numeraireReceived;
  c.timestamp = event.block.timestamp;
  c.txHash = event.transaction.hash;
  c.save();

  m.totalClaimed = m.totalClaimed.plus(event.params.numeraireReceived);
  m.save();

  const u = user(event.params.claimer);
  u.totalPaidOut = u.totalPaidOut.plus(event.params.numeraireReceived);
  u.realisedProfit = u.realisedProfit.plus(event.params.numeraireReceived);
  u.save();

  const p = protocol();
  p.totalPaidOut = p.totalPaidOut.plus(event.params.numeraireReceived);
  p.save();

  // Same trap as above: `resolved` is the real guard. A claim cannot happen
  // before resolution anyway, but reading winnerSide on an unresolved market
  // would silently mean side A.
  if (m.resolved) {
    const pos = Position.load(
      positionId(m.id, Address.fromBytes(event.params.claimer), m.winnerSide),
    );
    if (pos != null) {
      pos.claimed = true;
      pos.payout = pos.payout.plus(event.params.numeraireReceived);
      pos.save();
    }
  }
}
