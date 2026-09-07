import { Address, BigInt, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";

import { Beneficiary, Entry, Market, Pool, Protocol, User } from "../generated/schema";

export const ZERO = BigInt.fromI32(0);
export const WAD = BigInt.fromString("1000000000000000000");
export const PROTOCOL_ID = Bytes.fromUTF8("ratio");

export function protocol(): Protocol {
  let p = Protocol.load(PROTOCOL_ID);
  if (p == null) {
    p = new Protocol(PROTOCOL_ID);
    p.marketCount = 0;
    p.tradeCount = 0;
    p.totalStaked = ZERO;
    p.totalPaidOut = ZERO;
  }
  return p as Protocol;
}

export function user(addr: Address): User {
  let u = User.load(addr);
  if (u == null) {
    u = new User(addr);
    u.totalStaked = ZERO;
    u.totalPaidOut = ZERO;
    u.realisedProfit = ZERO;
    u.tradeCount = 0;
    u.wins = 0;
    u.losses = 0;
  }
  return u as User;
}

export function beneficiary(addr: Address): Beneficiary {
  let b = Beneficiary.load(addr);
  if (b == null) {
    b = new Beneficiary(addr);
    b.totalFees = ZERO;
    b.marketCount = 0;
  }
  return b as Beneficiary;
}

export function entryId(market: Bytes, side: i32): Bytes {
  return market.concat(Bytes.fromUTF8(":" + side.toString()));
}

export function positionId(market: Bytes, bettor: Address, side: i32): Bytes {
  return market.concat(bettor).concat(Bytes.fromUTF8(":" + side.toString()));
}

/** The entry a swap belongs to, via the forward-indexed Pool lookup. */
export function entryByPool(poolId: Bytes): Entry | null {
  const p = Pool.load(poolId);
  if (p == null) return null; // a pool that is not one of ours
  return Entry.load(p.entry);
}

/**
 * v4 poolId = keccak256(abi.encode(PoolKey)). Native ETH is currency0 because
 * address(0) sorts first, and the fee is always the dynamic flag regardless of
 * what InitData asked for — a PoolKey built with any other fee misses.
 */
export function poolIdFor(token: Address, hooks: Address): Bytes {
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromAddress(Address.zero()),
        ethereum.Value.fromAddress(token),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0x800000)),
        ethereum.Value.fromI32(8),
        ethereum.Value.fromAddress(hooks),
      ]),
    ),
  )!;
  return Bytes.fromByteArray(crypto.keccak256(encoded));
}

export function market(id: Bytes): Market | null {
  return Market.load(id);
}
