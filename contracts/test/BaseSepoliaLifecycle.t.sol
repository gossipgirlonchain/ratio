// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console } from "forge-std/Test.sol";

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
}
