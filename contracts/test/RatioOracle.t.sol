// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { IPredictionOracle } from "src/interfaces/IPredictionOracle.sol";
import {
    AlreadyFinalized,
    AlreadyInitialized,
    BadSide,
    BadTokens,
    OnlyAgent,
    RatioOracle,
    TokensAlreadySet,
    TokensNotSet,
    TooEarly
} from "src/RatioOracle.sol";
import { MarketExists, RatioOracleFactory } from "src/RatioOracleFactory.sol";

contract RatioOracleTest is Test {
    RatioOracleFactory internal factory;

    address internal agent = address(0xA6E17);
    address internal stranger = address(0xBAD);
    address internal tokenA = address(0xA);
    address internal tokenB = address(0xB);

    /// Side B's tweet id — a real-shaped one, 19 digits.
    uint256 internal constant MARKET_ID = 1_962_487_331_004_219_392;
    uint64 internal settlesAt;

    function setUp() public {
        vm.warp(1_757_000_000);
        settlesAt = uint64(block.timestamp + 24 hours);
        factory = new RatioOracleFactory(agent);
    }

    function _open() internal returns (RatioOracle oracle) {
        vm.prank(agent);
        oracle = RatioOracle(factory.createOracle(MARKET_ID, settlesAt));
    }

    function _openWithTokens() internal returns (RatioOracle oracle) {
        oracle = _open();
        vm.prank(agent);
        oracle.setEntryTokens(tokenA, tokenB);
    }

    // -------------------------------------------------------------------
    // Factory
    // -------------------------------------------------------------------

    function test_createOracle_initializesAndRecords() public {
        RatioOracle oracle = _open();

        assertEq(oracle.agent(), agent, "agent");
        assertEq(oracle.marketId(), MARKET_ID, "marketId");
        assertEq(oracle.settlesAt(), settlesAt, "settlesAt");
        assertEq(factory.oracleOf(MARKET_ID), address(oracle), "registry");
        assertFalse(oracle.isFinalized(), "must not start finalized");
    }

    /// The agent computes the oracle address before deploying it, because that
    /// address has to go into airlock.create as liquidityMigratorData.
    function test_predictOracle_matchesDeployedAddress() public {
        address predicted = factory.predictOracle(MARKET_ID);
        RatioOracle oracle = _open();
        assertEq(predicted, address(oracle), "prediction must match deployment");
    }

    function test_createOracle_rejectsDuplicateMarket() public {
        _open();
        vm.prank(agent);
        vm.expectRevert(MarketExists.selector);
        factory.createOracle(MARKET_ID, settlesAt);
    }

    function test_createOracle_onlyAgent() public {
        vm.prank(stranger);
        vm.expectRevert(OnlyAgent.selector);
        factory.createOracle(MARKET_ID, settlesAt);
    }

    /// Each market is its own oracle instance, because PredictionMigrator keys
    /// markets by oracle address. Two markets sharing one would merge pots.
    function test_separateMarketsGetSeparateOracles() public {
        vm.startPrank(agent);
        address first = factory.createOracle(MARKET_ID, settlesAt);
        address second = factory.createOracle(MARKET_ID + 1, settlesAt);
        vm.stopPrank();
        assertTrue(first != second, "markets must not share an oracle");
    }

    function test_clonesCannotBeReinitialized() public {
        RatioOracle oracle = _open();
        vm.prank(agent);
        vm.expectRevert(AlreadyInitialized.selector);
        oracle.initialize(stranger, 1, settlesAt);
    }

    // -------------------------------------------------------------------
    // Entry tokens
    // -------------------------------------------------------------------

    function test_setEntryTokens_onlyOnce() public {
        RatioOracle oracle = _openWithTokens();
        assertEq(oracle.entryTokens(0), tokenA, "side A");
        assertEq(oracle.entryTokens(1), tokenB, "side B");

        vm.prank(agent);
        vm.expectRevert(TokensAlreadySet.selector);
        oracle.setEntryTokens(tokenB, tokenA);
    }

    function test_setEntryTokens_onlyAgent() public {
        RatioOracle oracle = _open();
        vm.prank(stranger);
        vm.expectRevert(OnlyAgent.selector);
        oracle.setEntryTokens(tokenA, tokenB);
    }

    function test_setEntryTokens_rejectsDegeneratePairs() public {
        RatioOracle oracle = _open();
        vm.startPrank(agent);
        vm.expectRevert(BadTokens.selector);
        oracle.setEntryTokens(tokenA, tokenA);
        vm.expectRevert(BadTokens.selector);
        oracle.setEntryTokens(address(0), tokenB);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------
    // Resolution — the part that must be right
    // -------------------------------------------------------------------

    function test_declareWinner_sideB() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);

        vm.prank(agent);
        oracle.declareWinner(1, 120, 900, false);

        (address winner, bool finalized) = oracle.getWinner(address(oracle));
        assertEq(winner, tokenB, "side B token wins");
        assertTrue(finalized, "finalized");
        assertEq(oracle.winnerSide(), 1, "winnerSide");
        assertFalse(oracle.forfeit(), "not a forfeit");
    }

    /// An exact tie holds for side A: the original is not beaten unless it is
    /// actually beaten. Same convention as the Solana build.
    function test_declareWinner_tieGoesToSideA() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);

        vm.prank(agent);
        oracle.declareWinner(0, 300, 300, false);

        (address winner,) = oracle.getWinner(address(oracle));
        assertEq(winner, tokenA, "tie holds for side A");
    }

    function test_declareWinner_forfeitFlagged() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);

        vm.prank(agent);
        oracle.declareWinner(0, 60, 0, true);

        assertTrue(oracle.forfeit(), "forfeit recorded");
        (address winner, bool finalized) = oracle.getWinner(address(oracle));
        assertEq(winner, tokenA, "survivor takes it");
        assertTrue(finalized, "a forfeit still finalizes");
    }

    /// The migrator caches getWinner into market.winningToken on first read and
    /// every claim pays out of that. A second declaration would be silent theft
    /// from whoever already claimed, so resolution is terminal.
    function test_declareWinner_isTerminal() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);

        vm.startPrank(agent);
        oracle.declareWinner(0, 500, 100, false);
        vm.expectRevert(AlreadyFinalized.selector);
        oracle.declareWinner(1, 100, 500, false);
        vm.stopPrank();

        (address winner,) = oracle.getWinner(address(oracle));
        assertEq(winner, tokenA, "first verdict stands");
    }

    function test_declareWinner_onlyAgent() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);
        vm.prank(stranger);
        vm.expectRevert(OnlyAgent.selector);
        oracle.declareWinner(1, 0, 1, false);
    }

    /// A market cannot be called before its clock runs out, even by the agent.
    function test_declareWinner_beforeSettlesAtReverts() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt - 1);
        vm.prank(agent);
        vm.expectRevert(TooEarly.selector);
        oracle.declareWinner(1, 0, 1, false);
    }

    function test_declareWinner_atExactlySettlesAtSucceeds() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);
        vm.prank(agent);
        oracle.declareWinner(1, 0, 1, false);
        assertTrue(oracle.isFinalized(), "settlesAt is inclusive");
    }

    /// Resolving before tokens are attached would finalize with address(0) as
    /// the winner, which the migrator would happily cache.
    function test_declareWinner_withoutTokensReverts() public {
        RatioOracle oracle = _open();
        vm.warp(settlesAt);
        vm.prank(agent);
        vm.expectRevert(TokensNotSet.selector);
        oracle.declareWinner(0, 1, 0, false);
    }

    function test_declareWinner_rejectsOutOfRangeSide() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);
        vm.prank(agent);
        vm.expectRevert(BadSide.selector);
        oracle.declareWinner(2, 1, 0, false);
    }

    /// Until resolution the migrator must see isFinalized=false, or it would
    /// migrate entries early and let claims run against an undecided market.
    function test_getWinner_beforeResolutionIsNotFinalized() public {
        RatioOracle oracle = _openWithTokens();
        (address winner, bool finalized) = oracle.getWinner(address(oracle));
        assertEq(winner, address(0), "no winner yet");
        assertFalse(finalized, "not finalized");
    }

    /// The migrator calls getWinner(oracle) passing the oracle's own address.
    /// The argument is ignored; any address must give the same answer.
    function test_getWinner_ignoresItsArgument() public {
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);
        vm.prank(agent);
        oracle.declareWinner(1, 0, 1, false);

        (address a, bool fa) = oracle.getWinner(address(oracle));
        (address b, bool fb) = oracle.getWinner(stranger);
        assertEq(a, b, "argument must not change the answer");
        assertEq(fa, fb, "argument must not change finality");
    }

    function testFuzz_declareWinner_alwaysPicksTheNamedSide(
        uint8 side,
        uint256 likesA,
        uint256 likesB
    ) public {
        side = uint8(bound(side, 0, 1));
        RatioOracle oracle = _openWithTokens();
        vm.warp(settlesAt);

        vm.prank(agent);
        oracle.declareWinner(side, likesA, likesB, false);

        (address winner, bool finalized) = oracle.getWinner(address(oracle));
        assertEq(winner, side == 0 ? tokenA : tokenB, "winner follows the named side");
        assertTrue(finalized, "always finalizes");
    }
}
