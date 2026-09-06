// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPredictionOracle
 * @notice Vendored verbatim from whetstoneresearch/doppler @ pred-markets
 *         (src/interfaces/IPredictionOracle.sol). Copied rather than imported
 *         because the branch is 309 commits behind main and we do not want the
 *         rest of that tree in our build.
 *
 *         This is the only surface PredictionMigrator requires of us. It calls
 *         `IPredictionOracle(oracle).getWinner(oracle)` — the address argument
 *         is redundant when a market is one oracle instance, and is ignored,
 *         exactly as Whetstone's own MockPredictionOracle ignores it.
 */
interface IPredictionOracle {
    /// @notice Emitted when a winner is declared for a market
    event WinnerDeclared(address indexed oracle, address indexed winningToken);

    /// @notice Returns the winning token for a market
    /// @return winningToken Address of the winning entry's token (address(0) if not yet declared)
    /// @return isFinalized Whether the result is final and claims can proceed
    function getWinner(address oracle) external view returns (address winningToken, bool isFinalized);
}
