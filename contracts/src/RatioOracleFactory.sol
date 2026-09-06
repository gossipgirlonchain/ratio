// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { RatioOracle } from "src/RatioOracle.sol";

/// @notice Only the agent may open markets.
error OnlyAgent();
/// @notice A market with this id already has an oracle.
error MarketExists();
/// @notice Clone deployment failed.
error CloneFailed();

/**
 * @title RatioOracleFactory
 * @notice Deploys one RatioOracle per market as an EIP-1167 minimal proxy.
 *
 * Why a clone per market: PredictionMigrator keys markets by oracle address
 * (`_markets[oracle]`), so a shared oracle would collapse every ratio market
 * into one. A full deployment per tagged tweet would be wasteful; a 45-byte
 * proxy is not.
 *
 * Deployment is CREATE2 with the market id as salt, so the agent can compute a
 * market's oracle address BEFORE deploying it. That matters: the oracle address
 * has to go into `airlock.create` as `liquidityMigratorData`, and knowing it up
 * front means market creation can be retried idempotently after a crash without
 * stranding a half-built market.
 */
contract RatioOracleFactory {
    /// @notice Emitted for each market opened.
    event OracleCreated(uint256 indexed marketId, address indexed oracle, uint64 settlesAt);

    /// @notice The implementation every clone delegates to.
    address public immutable implementation;

    /// @notice Agent hot wallet: the only address that may open markets, and
    /// the agent each clone is initialized with.
    address public immutable agent;

    /// @notice marketId => oracle. Also the duplicate guard.
    mapping(uint256 marketId => address oracle) public oracleOf;

    constructor(address agent_) {
        require(agent_ != address(0), OnlyAgent());
        agent = agent_;
        implementation = address(new RatioOracle());
    }

    /**
     * @notice Deploy and initialize this market's oracle.
     * @param marketId Side B's tweet id.
     * @param settlesAt createdAt + 24h, in seconds.
     */
    function createOracle(uint256 marketId, uint64 settlesAt) external returns (address oracle) {
        require(msg.sender == agent, OnlyAgent());
        require(oracleOf[marketId] == address(0), MarketExists());

        oracle = _clone(implementation, bytes32(marketId));
        oracleOf[marketId] = oracle;
        RatioOracle(oracle).initialize(agent, marketId, settlesAt);

        emit OracleCreated(marketId, oracle, settlesAt);
    }

    /// @notice The address `createOracle` would produce for this market id.
    function predictOracle(uint256 marketId) external view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff), address(this), bytes32(marketId), keccak256(_cloneCode(implementation))
            )
        );
        return address(uint160(uint256(hash)));
    }

    /// @dev EIP-1167 minimal proxy runtime, CREATE2-deployed.
    function _clone(address impl, bytes32 salt) internal returns (address instance) {
        bytes memory code = _cloneCode(impl);
        assembly {
            instance := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(instance != address(0), CloneFailed());
    }

    function _cloneCode(address impl) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", impl, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
