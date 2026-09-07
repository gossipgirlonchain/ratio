import { RatioOracle as RatioOracleTemplate } from "../generated/templates";
import { OracleCreated } from "../generated/RatioOracleFactory/RatioOracleFactory";

/**
 * A market opened. The oracle does not exist as an indexable address until
 * this fires, so this is where its template gets instantiated — everything
 * else about the market arrives on the oracle itself.
 */
export function handleOracleCreated(event: OracleCreated): void {
  RatioOracleTemplate.create(event.params.oracle);
}
