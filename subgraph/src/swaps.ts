import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

import { Swap } from "../generated/PoolManager/PoolManager";
import { Entry, Market, Trade, Position } from "../generated/schema";
import { WAD, ZERO, entryByPool, positionId, protocol, user } from "./shared";

/**
 * A bet.
 *
 * Read from the v4 PoolManager rather than the DopplerHookInitializer. The
 * initializer's own Swap carries an INDEXED PoolKey struct, which graph-node
 * cannot decode — it aborts the handler and stalls the whole subgraph. The
 * PoolManager event is all value types and carries the same signed balance
 * deltas, which is where tokensOut comes from. On Solana that number lived in
 * an associated token account the swap never reported back, and every
 * token-weighted figure in the product quietly divided by a stored zero.
 *
 * PoolManager is a singleton, so this fires for every v4 swap on the chain.
 * Anything whose pool is not one of ours is dropped on the first lookup.
 */
export function handleSwap(event: Swap): void {
  const entry = entryByPool(event.params.id);
  if (entry == null) return; // some other Doppler pool, not a ratio market

  const market = Market.load(entry.market);
  if (market == null) return;

  // currency0 is native ETH, currency1 the outcome token. Buying the token
  // means ETH in (amount0 negative from the pool's view) and tokens out.
  const amount0 = event.params.amount0;
  const amount1 = event.params.amount1;
  const amountIn = amount0.lt(ZERO) ? amount0.neg() : amount0;
  const tokensOut = amount1.lt(ZERO) ? amount1.neg() : amount1;
  if (tokensOut.equals(ZERO)) return;

  // Sells are protocol-impossible (NoSellDopplerHook), so a swap that is not a
  // buy should not exist. If one ever does, skip rather than record a negative
  // position and quietly corrupt the payout maths.
  const isBuy = amount0.lt(ZERO) && amount1.gt(ZERO);
  if (!isBuy) return;

  /**
   * THE BETTOR IS transaction.from, NOT event.params.sender.
   *
   * `sender` is whoever called the PoolManager — the router — so using it
   * would attribute every bet in the protocol to one address. This is the
   * standard v4 indexing trap, and it is also why bets are never gas
   * sponsored: a paymaster or relayer would make transaction.from the sponsor
   * and collapse attribution just as badly.
   */
  const bettor = event.transaction.from;

  const t = new Trade(event.transaction.hash.concatI32(event.logIndex.toI32()));
  t.market = market.id;
  t.entry = entry.id;
  t.side = entry.side;
  t.bettor = bettor;
  t.amountIn = amountIn;
  t.tokensOut = tokensOut;
  // Entry price exists nowhere else: the pools drain at migration, so if this
  // is not captured at the moment of the swap it is gone for good.
  t.price = amountIn.times(WAD).div(tokensOut);
  t.blockNumber = event.block.number;
  t.timestamp = event.block.timestamp;
  t.txHash = event.transaction.hash;
  t.save();

  entry.staked = entry.staked.plus(amountIn);
  entry.tradeCount = entry.tradeCount + 1;
  entry.save();

  market.totalStaked = market.totalStaked.plus(amountIn);
  market.netStaked = market.netStaked.plus(amountIn);
  market.tradeCount = market.tradeCount + 1;
  market.save();

  const pid = positionId(market.id, Address.fromBytes(bettor), entry.side);
  let pos = Position.load(pid);
  if (pos == null) {
    pos = new Position(pid);
    pos.market = market.id;
    pos.entry = entry.id;
    pos.bettor = bettor;
    pos.user = bettor;
    pos.side = entry.side;
    pos.tokens = ZERO;
    pos.netStaked = ZERO;
    pos.tradeCount = 0;
    pos.claimed = false;
    pos.payout = ZERO;
  }
  pos.tokens = pos.tokens.plus(tokensOut);
  pos.netStaked = pos.netStaked.plus(amountIn);
  pos.tradeCount = pos.tradeCount + 1;
  pos.save();

  const u = user(Address.fromBytes(bettor));
  u.totalStaked = u.totalStaked.plus(amountIn);
  // realisedProfit is deliberately NOT touched here. Money in an open market
  // is neither won nor lost, and counting it as a loss on the way in would
  // rank every active trader below someone who has never bet.
  u.tradeCount = u.tradeCount + 1;
  u.save();

  const p = protocol();
  p.tradeCount = p.tradeCount + 1;
  p.totalStaked = p.totalStaked.plus(amountIn);
  p.save();
}
