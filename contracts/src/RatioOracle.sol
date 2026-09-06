// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPredictionOracle } from "src/interfaces/IPredictionOracle.sol";

/// @notice Only the agent may resolve this market.
error OnlyAgent();
/// @notice The winner has already been declared; resolution is terminal.
error AlreadyFinalized();
/// @notice Entry tokens have not been attached yet.
error TokensNotSet();
/// @notice Entry tokens are attached once and never change.
error TokensAlreadySet();
/// @notice A market cannot resolve before its 24h clock runs out.
error TooEarly();
/// @notice A clone may only be initialized once.
error AlreadyInitialized();
/// @notice Side must be 0 (A) or 1 (B).
error BadSide();
/// @notice Entry tokens must be two distinct non-zero addresses.
error BadTokens();

/**
 * @title RatioOracle
 * @notice The one contract ratio owns on EVM.
 *
 * Doppler's PredictionMigrator holds the pot and pays claims, and keys markets
 * by ORACLE ADDRESS — so one ratio market is one RatioOracle instance, deployed
 * as a minimal proxy by RatioOracleFactory.
 *
 * All this does is answer "who won", and refuse to answer it wrongly. The agent
 * counts likes at 24 hours off-chain (X is the referee and cannot be read from
 * a contract) and relays the verdict here. Same trusted-oracle model as the
 * Solana build; no decentralised resolution scheme is claimed or implied.
 *
 * The guards exist because the relay is a single key and a wrong call is
 * unrecoverable: the migrator reads `getWinner` once, caches it in
 * `market.winningToken`, and every claim pays out of that. There is no undo.
 */
contract RatioOracle is IPredictionOracle {
    /// @notice Emitted at clone initialization: the only place the chain
    /// records which tweet this market is about. The migrator has no concept
    /// of a tweet, so without this the subgraph cannot join to anything.
    event MarketOpened(
        address indexed oracle, uint256 indexed marketId, address indexed agent, uint64 settlesAt
    );

    /// @notice Emitted when the two entry tokens are attached, after both
    /// Airlock creates have landed.
    event EntryTokensSet(address indexed oracle, address tokenA, address tokenB);

    /// @notice The likes verdict itself, on chain. Not consumed by the
    /// migrator — it exists so the resolution is self-describing and the
    /// subgraph can show why a market ended without trusting our database.
    event RatioResolved(
        address indexed oracle,
        uint256 indexed marketId,
        uint8 winnerSide,
        uint256 likesA,
        uint256 likesB,
        bool forfeit
    );

    /// @notice Agent hot wallet: the only address that may resolve.
    address public agent;

    /// @notice Side B's tweet id — the market's identity everywhere else.
    uint256 public marketId;

    /// @notice createdAt + 24h. Resolution before this reverts.
    uint64 public settlesAt;

    /// @notice Entry tokens, index 0 = side A, index 1 = side B. These match
    /// the `entryId`s registered with the migrator (bytes32(uint256(side))).
    address[2] public entryTokens;

    /// @notice Set once tokens are attached.
    bool public tokensSet;

    /// @notice Winning entry token, address(0) until resolved.
    address public winningToken;

    /// @notice Whether the verdict is final and claims may proceed.
    bool public isFinalized;

    /// @notice Winning side index, valid once finalized.
    uint8 public winnerSide;

    /// @notice True when the win was by forfeit (a side became unreadable)
    /// rather than on like counts. Display only; payout is identical.
    bool public forfeit;

    modifier onlyAgent() {
        require(msg.sender == agent, OnlyAgent());
        _;
    }

    /**
     * @notice Initialize a freshly cloned oracle.
     * @dev Clones have no constructor. `agent == address(0)` is the
     *      uninitialized sentinel, so this can only ever run once.
     */
    function initialize(address agent_, uint256 marketId_, uint64 settlesAt_) external {
        require(agent == address(0), AlreadyInitialized());
        require(agent_ != address(0), OnlyAgent());
        agent = agent_;
        marketId = marketId_;
        settlesAt = settlesAt_;
        emit MarketOpened(address(this), marketId_, agent_, settlesAt_);
    }

    /**
     * @notice Attach the two entry tokens.
     * @dev Separate from initialize because of an ordering constraint: the
     *      oracle address must be passed to `airlock.create` as
     *      `liquidityMigratorData`, so the oracle has to exist BEFORE either
     *      token does. Attached once, then immutable.
     */
    function setEntryTokens(address tokenA, address tokenB) external onlyAgent {
        require(!tokensSet, TokensAlreadySet());
        require(
            tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, BadTokens()
        );
        entryTokens[0] = tokenA;
        entryTokens[1] = tokenB;
        tokensSet = true;
        emit EntryTokensSet(address(this), tokenA, tokenB);
    }

    /**
     * @notice Relay the 24h likes verdict. Terminal.
     * @param side 0 if side A won, 1 if side B won. An exact tie resolves to
     *        side A by the same convention the Solana build uses — the
     *        original holds unless it is actually beaten.
     * @param likesA Final like count on side A, recorded for the log only.
     * @param likesB Final like count on side B, recorded for the log only.
     * @param forfeit_ True when the losing side became unreadable (deleted,
     *        suspended, private) rather than losing on counts.
     */
    function declareWinner(uint8 side, uint256 likesA, uint256 likesB, bool forfeit_)
        external
        onlyAgent
    {
        require(!isFinalized, AlreadyFinalized());
        require(tokensSet, TokensNotSet());
        require(side < 2, BadSide());
        require(block.timestamp >= settlesAt, TooEarly());

        winnerSide = side;
        winningToken = entryTokens[side];
        forfeit = forfeit_;
        isFinalized = true;

        emit RatioResolved(address(this), marketId, side, likesA, likesB, forfeit_);
        emit WinnerDeclared(address(this), winningToken);
    }

    /// @inheritdoc IPredictionOracle
    /// @dev The argument is the oracle address, which is this contract. It is
    ///      redundant for a one-market-one-oracle layout and is ignored, the
    ///      same way Whetstone's MockPredictionOracle ignores it.
    function getWinner(address) external view returns (address, bool) {
        return (winningToken, isFinalized);
    }
}
