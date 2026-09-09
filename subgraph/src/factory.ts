import { RatioOracle as RatioOracleTemplate } from "../generated/templates";
import { OracleCreated } from "../generated/RatioOracleFactory/RatioOracleFactory";
import { Market } from "../generated/schema";
import { ZERO, protocol } from "./shared";

/**
 * A market opened. Two jobs, and the second one is not optional.
 *
 * The template gets instantiated here, because the oracle does not exist as an
 * indexable address until this fires.
 *
 * The Market entity is ALSO created here, rather than on the oracle's own
 * `MarketOpened`, because a dynamic data source does not see events from the
 * block it was created in. The oracle emits `MarketOpened` in exactly that
 * block, so the entity would not exist until something later touched it —
 * and in the meantime the migrator's `EntryRegistered` for side 0 arrives,
 * finds no market, and drops the entry. That is not a cosmetic gap: it lost
 * one whole side of a market's money from the index while the other side
 * indexed normally, which reads as a market nobody bet against.
 *
 * This handler is on a static data source, so it always runs, and it carries
 * everything the entity needs.
 */
export function handleOracleCreated(event: OracleCreated): void {
  RatioOracleTemplate.create(event.params.oracle);

  let m = Market.load(event.params.oracle);
  if (m != null) return;

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
