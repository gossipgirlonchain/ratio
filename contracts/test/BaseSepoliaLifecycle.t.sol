// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console } from "forge-std/Test.sol";

import { PoolSwapTest } from "@v4-core/test/PoolSwapTest.sol";
import { IHooks } from "@v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "@v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "@v4-core/types/PoolKey.sol";
import { Currency } from "@v4-core/types/Currency.sol";
import { SwapParams } from "@v4-core/types/PoolOperation.sol";
import { TickMath } from "@v4-core/libraries/TickMath.sol";

import { RatioOracle } from "src/RatioOracle.sol";
import { RatioOracleFactory } from "src/RatioOracleFactory.sol";

// ---------------------------------------------------------------------------
// Minimal views of the DEPLOYED Doppler contracts. Vendored rather than
// imported: the pred-markets branch is 309 commits behind main and we do not
// want that tree in our build. Struct layouts were diffed against both main
// and pred-markets and are identical.
// ---------------------------------------------------------------------------

struct CreateParams {
    uint256 initialSupply;
    uint256 numTokensToSell;
    address numeraire;
    address tokenFactory;
    bytes tokenFactoryData;
    address governanceFactory;
    bytes governanceFactoryData;
    address poolInitializer;
    bytes poolInitializerData;
    address liquidityMigrator;
    bytes liquidityMigratorData;
    address integrator;
    bytes32 salt;
}

struct Curve {
    int24 tickLower;
    int24 tickUpper;
    uint16 numPositions;
    uint256 shares;
}

struct VestingSchedule {
    uint64 cliff;
    uint64 duration;
}

struct BeneficiaryData {
    address beneficiary;
    uint96 shares;
}

struct InitData {
    uint24 fee;
    int24 tickSpacing;
    int24 farTick;
    Curve[] curves;
    BeneficiaryData[] beneficiaries;
    address dopplerHook;
    bytes onInitializationDopplerHookCalldata;
    bytes graduationDopplerHookCalldata;
}

interface IAirlock {
    function create(CreateParams calldata createData)
        external
        returns (
            address asset,
            address pool,
            address governance,
            address timelock,
            address migrationPool
        );
    function migrate(address asset) external;
    function getModuleState(address module) external view returns (uint8);
    function owner() external view returns (address);
}

// The pool's fee is LPFeeLibrary.DYNAMIC_FEE_FLAG — the initializer sets it,
// regardless of the `fee` we pass in InitData. Read off the live trace.
uint24 constant DYNAMIC_FEE_FLAG = 0x800000;

interface IPredictionMigratorView {
    function previewClaim(address oracle, uint256 tokenAmount) external view returns (uint256);
    function claim(address oracle, uint256 tokenAmount) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function burn(uint256) external;
}

/**
 * @title Base Sepolia lifecycle smoke test
 * @notice Runs against the REAL deployed Doppler prediction market by forking
 *         Base Sepolia. Unit tests cannot find a bug in someone else's
 *         bytecode; this can.
 *
 *         The deployed PredictionMigrator has never processed a single
 *         transaction — zero EntryRegistered, EntryMigrated and Claimed events
 *         since February. Everything here is the first time this code has been
 *         asked to do anything.
 *
 *         Run: forge test --match-contract BaseSepoliaLifecycle -vv
 *         (needs network access; set BASE_SEPOLIA_RPC_URL for a better RPC)
 */
contract BaseSepoliaLifecycleTest is Test {
    // Verified live 2026-09-06 — see contracts/BASE-SEPOLIA.md
    IAirlock constant AIRLOCK = IAirlock(0x3411306Ce66c9469BFF1535BA955503c4Bde1C6e);
    address constant PREDICTION_MIGRATOR = 0x91aad599EfD70E633d091FC060cc6f9D3e5298BE;
    address constant NO_SELL_HOOK = 0x21588C923de63914cbc624002417c2AA64a15bFe;
    address constant HOOK_INITIALIZER = 0xAA096F558f3d4c9226De77E7Cc05f18E180B2544;
    address constant NO_OP_GOVERNANCE = 0x7bD798fafC99A3b17E261F8308A8C11B56935ea1;
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    /// token_factory_80. Whitelisted, and markets CREATE fine against it, but
    /// its token's burn() is owner-gated so migrate() reverts. Kept as a
    /// constant only so the diagnostic test can prove that.
    address constant TOKEN_FACTORY_80 = 0xf0B5141dD9096254B2ca624dff26024f46087229;

    /// The one that actually works end to end.
    address constant TOKEN_FACTORY = CLONE_DERC20_V2_VOTES;

    /// clone_derc20_v2_votes_factory. Its CloneDERC20VotesV2 has an OPEN
    /// burn(), which token_factory_80's token does not — see
    /// test_findAWorkingTokenFactory.
    address constant CLONE_DERC20_V2_VOTES = 0x16F5ACB64F4FA17296E942C51d3395aDC318f9e1;

    /// Native ETH. Users fund one asset, bet with it, and pay gas with it.
    address constant NUMERAIRE = address(0);

    /// Swappable so we can find one whose burn() the migrator can actually call.
    address internal tokenFactory = TOKEN_FACTORY;

    RatioOracleFactory internal oracleFactory;
    RatioOracle internal oracle;

    address internal agent = address(0xA6E17);
    uint256 internal constant MARKET_ID = 1_962_487_331_004_219_392;
    uint64 internal settlesAt;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_SEPOLIA_RPC_URL", string("https://sepolia.base.org")));
        settlesAt = uint64(block.timestamp + 24 hours);
        vm.deal(agent, 10 ether);
        vm.prank(agent);
        oracleFactory = new RatioOracleFactory(agent);
    }

    /// Sanity: the deployment is what BASE-SEPOLIA.md says it is, read from a
    /// fork of live state rather than from our notes.
    function test_deploymentIsWiredAsDocumented() public view {
        assertEq(AIRLOCK.getModuleState(PREDICTION_MIGRATOR), 4, "migrator must be LiquidityMigrator");
        assertEq(AIRLOCK.getModuleState(HOOK_INITIALIZER), 3, "initializer must be PoolInitializer");
        assertEq(AIRLOCK.getModuleState(TOKEN_FACTORY), 1, "token factory must be whitelisted");
        assertEq(AIRLOCK.getModuleState(NO_OP_GOVERNANCE), 2, "governance factory must be whitelisted");
        assertTrue(PREDICTION_MIGRATOR.code.length > 0, "migrator deployed");
        assertTrue(NO_SELL_HOOK.code.length > 0, "no-sell hook deployed");
    }

    /// The factory the upstream deploy script points at is not usable for
    /// creating markets. Recording it as a test so it cannot regress silently.
    function test_cloneErc20FactoryIsNotWhitelisted() public view {
        assertEq(
            AIRLOCK.getModuleState(0xbf4Ca4D527c9760A884df31292f72E9AcA503045),
            0,
            "clone_erc20_factory is not a whitelisted TokenFactory"
        );
    }

    function _poolInitializerData() internal pure returns (bytes memory) {
        Curve[] memory curves = new Curve[](1);
        curves[0] = Curve({ tickLower: 0, tickUpper: 240_000, numPositions: 10, shares: 1e18 });

        return abi.encode(
            InitData({
                fee: 0,
                tickSpacing: 8,
                // farTick == startTick: migration is gated by the ORACLE, not by
                // price. This is the constraint Whetstone removed specifically
                // for prediction markets.
                farTick: 0,
                curves: curves,
                beneficiaries: new BeneficiaryData[](0),
                dopplerHook: NO_SELL_HOOK,
                onInitializationDopplerHookCalldata: "",
                graduationDopplerHookCalldata: ""
            })
        );
    }

    function _createEntry(uint8 side, string memory name, string memory symbol)
        internal
        returns (address asset)
    {
        return _createEntry(side, name, symbol, tokenFactory);
    }

    function _createEntry(uint8 side, string memory name, string memory symbol, address factory)
        internal
        returns (address asset)
    {
        CreateParams memory params = CreateParams({
            initialSupply: 1_000_000 ether,
            numTokensToSell: 1_000_000 ether,
            numeraire: NUMERAIRE,
            tokenFactory: factory,
            tokenFactoryData: factory == CLONE_DERC20_V2_VOTES
                // (name, symbol, yearlyMintRate, schedules, beneficiaries,
                //  scheduleIds, amounts, tokenURI)
                ? abi.encode(
                    name,
                    symbol,
                    uint256(0),
                    new VestingSchedule[](0),
                    new address[](0),
                    new uint256[](0),
                    new uint256[](0),
                    ""
                )
                : abi.encode(
                    name, symbol, uint256(0), uint256(0), new address[](0), new uint256[](0), ""
                ),
            governanceFactory: NO_OP_GOVERNANCE,
            governanceFactoryData: abi.encode(name),
            poolInitializer: HOOK_INITIALIZER,
            poolInitializerData: _poolInitializerData(),
            liquidityMigrator: PREDICTION_MIGRATOR,
            // (oracle, entryId). entryId is just the side index — the migrator
            // only needs uniqueness within a market.
            liquidityMigratorData: abi.encode(address(oracle), bytes32(uint256(side))),
            integrator: address(0),
            salt: keccak256(abi.encodePacked(MARKET_ID, side, block.timestamp))
        });

        vm.prank(agent);
        (asset,,,,) = AIRLOCK.create(params);
    }

    /// Stage 1 of the lifecycle: open a market and register both entries
    /// against the real migrator. This is the first thing that contract has
    /// ever been asked to do.
    function test_lifecycle_createAndRegisterBothEntries() public {
        vm.prank(agent);
        oracle = RatioOracle(oracleFactory.createOracle(MARKET_ID, settlesAt));
        console.log("oracle", address(oracle));

        address assetA = _createEntry(0, "ratio A", "RTOA");
        console.log("side A token", assetA);

        address assetB = _createEntry(1, "ratio B", "RTOB");
        console.log("side B token", assetB);

        assertTrue(assetA != address(0) && assetB != address(0), "both entries created");
        assertTrue(assetA != assetB, "entries are distinct");

        vm.prank(agent);
        oracle.setEntryTokens(assetA, assetB);
        assertEq(oracle.entryTokens(0), assetA, "side A attached");
        assertEq(oracle.entryTokens(1), assetB, "side B attached");

        // Entry tokens must be burnable or migrate() reverts (integration guide).
        IERC20Like(assetA).totalSupply();
        console.log("side A supply", IERC20Like(assetA).totalSupply());
    }

    /// The migrator must refuse to migrate before our oracle finalizes. This is
    /// the interlock the whole design rests on: if it did not hold, entries
    /// could migrate and claims could run against an undecided market.
    function test_lifecycle_migrateBeforeResolutionReverts() public {
        vm.prank(agent);
        oracle = RatioOracle(oracleFactory.createOracle(MARKET_ID, settlesAt));
        address assetA = _createEntry(0, "ratio A", "RTOA");
        address assetB = _createEntry(1, "ratio B", "RTOB");
        vm.prank(agent);
        oracle.setEntryTokens(assetA, assetB);

        vm.expectRevert();
        AIRLOCK.migrate(assetA);
    }

    /// Stage 2: resolve, then migrate both entries. Zero-proceeds migration is
    /// explicitly supported (farTick == startTick), so this runs without any
    /// bets having been placed.
    function test_lifecycle_resolveThenMigrate() public {
        vm.prank(agent);
        oracle = RatioOracle(oracleFactory.createOracle(MARKET_ID, settlesAt));
        address assetA = _createEntry(0, "ratio A", "RTOA");
        address assetB = _createEntry(1, "ratio B", "RTOB");
        vm.prank(agent);
        oracle.setEntryTokens(assetA, assetB);

        vm.warp(settlesAt);
        vm.prank(agent);
        oracle.declareWinner(1, 120, 900, false);

        (address winner, bool finalized) = oracle.getWinner(address(oracle));
        assertEq(winner, assetB, "side B won");
        assertTrue(finalized, "finalized");

        AIRLOCK.migrate(assetA);
        AIRLOCK.migrate(assetB);
        console.log("both entries migrated");
    }

    /// FINDING: PredictionMigrator.migrate() burns unsold entry tokens, but
    /// Airlock transfers token ownership to the timelock immediately BEFORE
    /// calling the migrator. token_factory_80 mints tokens whose burn() is
    /// owner-gated, so the migrator — which is not the owner — cannot burn,
    /// and migrate reverts with OwnableUnauthorizedAccount(migrator).
    ///
    /// The integration guide warns "if burn is unavailable/restricted, migrate
    /// reverts". This pins down which of Base Sepolia's whitelisted token
    /// factories actually satisfies that.
    function test_findAWorkingTokenFactory() public {
        address[2] memory candidates = [TOKEN_FACTORY_80, CLONE_DERC20_V2_VOTES];

        for (uint256 i = 0; i < candidates.length; i++) {
            tokenFactory = candidates[i];
            console.log("--- token factory ---", tokenFactory);

            vm.prank(agent);
            oracle = RatioOracle(oracleFactory.createOracle(MARKET_ID + i, settlesAt));

            try this.externalCreateEntry(0, "ratio A", "RTOA") returns (address assetA) {
                try this.externalCreateEntry(1, "ratio B", "RTOB") returns (address assetB) {
                    vm.prank(agent);
                    oracle.setEntryTokens(assetA, assetB);
                    vm.warp(settlesAt);
                    vm.prank(agent);
                    oracle.declareWinner(1, 120, 900, false);

                    try AIRLOCK.migrate(assetA) {
                        console.log("  MIGRATE OK");
                    } catch {
                        console.log("  MIGRATE REVERTED (burn not callable by migrator)");
                    }
                } catch {
                    console.log("  create side B reverted");
                }
            } catch {
                console.log("  create side A reverted");
            }
        }
    }

    function externalCreateEntry(uint8 side, string memory name, string memory symbol)
        external
        returns (address)
    {
        return _createEntry(side, name, symbol, tokenFactory);
    }

    // -------------------------------------------------------------------
    // The full cycle, with money in it
    // -------------------------------------------------------------------

    function _poolKey(address asset) internal pure returns (PoolKey memory) {
        // currency0 is native ETH (address(0)), which always sorts first.
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(asset),
            fee: DYNAMIC_FEE_FLAG,
            tickSpacing: 8,
            hooks: IHooks(HOOK_INITIALIZER)
        });
    }

    /// Buy an entry token with native ETH: currency0 -> currency1, exact input.
    function _bet(PoolSwapTest router, address asset, address bettor, uint256 amountIn)
        internal
        returns (uint256 tokensOut)
    {
        uint256 before = IERC20Like(asset).balanceOf(bettor);
        vm.prank(bettor);
        router.swap{ value: amountIn }(
            _poolKey(asset),
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
        tokensOut = IERC20Like(asset).balanceOf(bettor) - before;
    }

    /// The whole thing: two entries, real bets on both sides, resolve, migrate
    /// both, and claim. Claim is the half that carries the payout maths.
    function test_lifecycle_fullCycleWithBetsAndClaim() public {
        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));

        address alice = address(0xA11CE);
        address bob = address(0xB0B);
        vm.deal(alice, 5 ether);
        vm.deal(bob, 5 ether);

        vm.prank(agent);
        oracle = RatioOracle(oracleFactory.createOracle(MARKET_ID, settlesAt));
        address assetA = _createEntry(0, "ratio A", "RTOA");
        address assetB = _createEntry(1, "ratio B", "RTOB");
        vm.prank(agent);
        oracle.setEntryTokens(assetA, assetB);

        // Two bettors back side B, one backs side A. Side B is going to win.
        uint256 aliceTokens = _bet(router, assetB, alice, 0.02 ether);
        uint256 bobTokens = _bet(router, assetB, bob, 0.01 ether);
        uint256 loserTokens = _bet(router, assetA, alice, 0.03 ether);

        console.log("alice side B tokens", aliceTokens);
        console.log("bob   side B tokens", bobTokens);
        console.log("alice side A tokens (losing)", loserTokens);
        assertGt(aliceTokens, 0, "a bet must yield tokens");
        assertGt(bobTokens, 0, "a bet must yield tokens");

        assertGt(aliceTokens, bobTokens, "bigger stake, more tokens");

        // OBSERVATION worth carrying into pricing: with these curve parameters
        // the operating range is effectively LINEAR. Alice staked 2x Bob and
        // received slightly MORE than 2x his tokens — because she bought first,
        // and time priority outweighs her own price impact by orders of
        // magnitude at this size. Her 0.02 ETH barely moves a curve minted
        // against 1e24 tokens.
        //
        // This does not break anything, but it means the curve only prices size
        // in if tickLower/tickUpper/shares are tuned so realistic stakes are
        // material against the curve. Until they are, the linear pot-share
        // approximation in packages/ui/payout.ts is not actually wrong here —
        // it is wrong in the regime we have not reached yet.
        assertGt(aliceTokens, bobTokens * 2, "first money in gets the better price");
        console.log("alice tokens per wei x1e6", (aliceTokens * 1e6) / 0.02 ether);
        console.log("bob   tokens per wei x1e6", (bobTokens * 1e6) / 0.01 ether);

        vm.warp(settlesAt);
        vm.prank(agent);
        oracle.declareWinner(1, 120, 900, false);

        AIRLOCK.migrate(assetA);
        AIRLOCK.migrate(assetB);

        uint256 pot = PREDICTION_MIGRATOR.balance;
        console.log("pot (wei)", pot);
        assertGt(pot, 0, "losing side's ETH must be in the pot");

        // Claim. previewClaim first, then the real thing, and they must agree.
        uint256 preview = IPredictionMigratorView(PREDICTION_MIGRATOR).previewClaim(
            address(oracle), aliceTokens
        );
        uint256 aliceBefore = alice.balance;

        vm.startPrank(alice);
        IERC20Like(assetB).approve(PREDICTION_MIGRATOR, aliceTokens);
        IPredictionMigratorView(PREDICTION_MIGRATOR).claim(address(oracle), aliceTokens);
        vm.stopPrank();

        uint256 alicePaid = alice.balance - aliceBefore;
        console.log("alice preview", preview);
        console.log("alice paid   ", alicePaid);
        assertEq(alicePaid, preview, "previewClaim must match the real payout");
        assertGt(alicePaid, 0, "a winner must be paid");

        // Bob claims too. Both winners paid out of one pot, pro rata.
        uint256 bobBefore = bob.balance;
        vm.startPrank(bob);
        IERC20Like(assetB).approve(PREDICTION_MIGRATOR, bobTokens);
        IPredictionMigratorView(PREDICTION_MIGRATOR).claim(address(oracle), bobTokens);
        vm.stopPrank();
        uint256 bobPaid = bob.balance - bobBefore;
        console.log("bob   paid   ", bobPaid);

        // payout = tokens / claimableSupply * totalPot, so the ratio of
        // payouts is the ratio of token holdings.
        assertGt(alicePaid, bobPaid, "more tokens, more payout");
        assertApproxEqRel(
            alicePaid * bobTokens, bobPaid * aliceTokens, 1e12, "payout must be pro rata in TOKENS"
        );

        // Winners cannot take more than the pot.
        assertLe(alicePaid + bobPaid, pot, "payouts cannot exceed the pot");
        console.log("total paid   ", alicePaid + bobPaid);
    }

    /// The losing side gets nothing. Claiming with a losing token must fail.
    function test_lifecycle_losingSideCannotClaim() public {
        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        address alice = address(0xA11CE);
        vm.deal(alice, 5 ether);

        vm.prank(agent);
        oracle = RatioOracle(oracleFactory.createOracle(MARKET_ID, settlesAt));
        address assetA = _createEntry(0, "ratio A", "RTOA");
        address assetB = _createEntry(1, "ratio B", "RTOB");
        vm.prank(agent);
        oracle.setEntryTokens(assetA, assetB);

        uint256 loserTokens = _bet(router, assetA, alice, 0.02 ether);
        _bet(router, assetB, alice, 0.01 ether);

        vm.warp(settlesAt);
        vm.prank(agent);
        oracle.declareWinner(1, 120, 900, false);
        AIRLOCK.migrate(assetA);
        AIRLOCK.migrate(assetB);

        vm.startPrank(alice);
        IERC20Like(assetA).approve(PREDICTION_MIGRATOR, loserTokens);
        vm.expectRevert();
        IPredictionMigratorView(PREDICTION_MIGRATOR).claim(address(oracle), loserTokens);
        vm.stopPrank();
    }

    /// The subgraph attributes every swap by recomputing the pool id from the
    /// entry token. If that derivation is wrong it matches nothing, indexes
    /// nothing, and reports no error — the worst failure shape there is. So it
    /// is pinned here against the real thing.
    ///
    /// Verified 2026-09-07 against the live Swap log of tx
    /// 0xb766cc3f...11befd (side B bet in our first real market):
    ///   expected 0xea7f426500b828d8efb96e94010053e1d6ee28bb8983fff46598b02fe83e722b
    function test_subgraphPoolIdDerivationMatchesLiveLog() public pure {
        address tokenB = 0x9CFa0D8F56F18C65185111c8277faa3235659693;
        bytes32 poolId = keccak256(
            abi.encode(
                address(0), // native ETH is currency0: address(0) sorts first
                tokenB,
                DYNAMIC_FEE_FLAG, // NOT the fee passed in InitData
                int24(8),
                HOOK_INITIALIZER
            )
        );
        assertEq(
            poolId,
            0xea7f426500b828d8efb96e94010053e1d6ee28bb8983fff46598b02fe83e722b,
            "pool id derivation drifted from the live chain"
        );
    }
}
