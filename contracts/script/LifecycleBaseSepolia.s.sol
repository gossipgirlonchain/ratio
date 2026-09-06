// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";

import { PoolSwapTest } from "@v4-core/test/PoolSwapTest.sol";
import { IHooks } from "@v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "@v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "@v4-core/types/PoolKey.sol";
import { Currency } from "@v4-core/types/Currency.sol";
import { SwapParams } from "@v4-core/types/PoolOperation.sol";
import { TickMath } from "@v4-core/libraries/TickMath.sol";

import { RatioOracle } from "src/RatioOracle.sol";
import { RatioOracleFactory } from "src/RatioOracleFactory.sol";

struct VestingSchedule {
    uint64 cliff;
    uint64 duration;
}

struct BeneficiaryData {
    address beneficiary;
    uint96 shares;
}

struct Curve {
    int24 tickLower;
    int24 tickUpper;
    uint16 numPositions;
    uint256 shares;
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

interface IAirlock {
    function create(CreateParams calldata createData)
        external
        returns (address asset, address pool, address governance, address timelock, address migrationPool);
    function migrate(address asset) external;
}

interface IPredictionMigrator {
    function previewClaim(address oracle, uint256 tokenAmount) external view returns (uint256);
    function claim(address oracle, uint256 tokenAmount) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/**
 * @title One real ratio market on Base Sepolia, end to end
 * @notice Broadcasts the full lifecycle so the submission has block-explorer
 *         links: deploy the oracle factory, open a market, create both entries,
 *         bet on both sides, resolve, migrate, claim.
 *
 *         Proven first against a fork of live state in
 *         test/BaseSepoliaLifecycle.t.sol. This is the same sequence with real
 *         transactions.
 *
 *         settlesAt is set to now, because a real chain cannot be warped. The
 *         "cannot resolve early" guard is covered by the unit tests instead.
 *
 *         Run from contracts/:
 *           forge script script/LifecycleBaseSepolia.s.sol:LifecycleBaseSepolia \
 *             --rpc-url https://sepolia.base.org \
 *             --skip-simulation \
 *             --broadcast -vvv
 *
 *         --skip-simulation is REQUIRED. Without it foundry's post-run replay
 *         fails on Base Sepolia with "invalid fee token: 0x20C0...", an
 *         OP-stack custom-gas-token path this foundry build mishandles. The
 *         script body runs fine either way; it is the replay that breaks, and
 *         the fork test already covers what the replay would have checked.
 *
 *         Needs BASE_SEPOLIA_PRIVATE_KEY in contracts/.env (foundry loads .env
 *         from the working directory, not the repo root). TESTNET ONLY.
 */
contract LifecycleBaseSepolia is Script {
    IAirlock constant AIRLOCK = IAirlock(0x3411306Ce66c9469BFF1535BA955503c4Bde1C6e);
    address constant PREDICTION_MIGRATOR = 0x91aad599EfD70E633d091FC060cc6f9D3e5298BE;
    address constant NO_SELL_HOOK = 0x21588C923de63914cbc624002417c2AA64a15bFe;
    address constant HOOK_INITIALIZER = 0xAA096F558f3d4c9226De77E7Cc05f18E180B2544;
    address constant NO_OP_GOVERNANCE = 0x7bD798fafC99A3b17E261F8308A8C11B56935ea1;
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    /// clone_derc20_v2_votes_factory: whitelisted AND its token's burn() is
    /// open, which token_factory_80's is not. See FEEDBACK.md section 2.
    address constant TOKEN_FACTORY = 0x16F5ACB64F4FA17296E942C51d3395aDC318f9e1;

    /// The initializer always creates the pool with the dynamic-fee flag,
    /// whatever InitData.fee says. A PoolKey built with any other fee misses.
    uint24 constant DYNAMIC_FEE_FLAG = 0x800000;

    /// Native ETH. One asset to fund, bet with, and pay gas with.
    address constant NUMERAIRE = address(0);

    /// Deliberately tiny. Base Sepolia gas is 0.006 gwei, so the whole run
    /// costs ~0.00007 ETH in gas; the bets are the only real spend. Keeping
    /// them small means a single small faucet drip covers the entire cycle,
    /// and the payout maths is identical at any size.
    uint256 constant BET = 0.0002 ether;

    /// Enough for both bets plus ~12M gas, with headroom.
    uint256 constant NEEDED = 0.0005 ether;

    RatioOracle oracle;
    address operator;

    function run() external {
        uint256 pk = vm.envUint("BASE_SEPOLIA_PRIVATE_KEY");
        operator = vm.addr(pk);
        console.log("operator", operator);
        console.log("balance ", operator.balance);
        if (operator.balance < NEEDED) {
            console.log("needed (wei)", NEEDED);
            console.log("have   (wei)", operator.balance);
            revert("fund the operator with Base Sepolia ETH first");
        }

        uint256 marketId = block.timestamp; // stands in for side B's tweet id
        uint64 settlesAt = uint64(block.timestamp);

        vm.startBroadcast(pk);

        RatioOracleFactory factory = new RatioOracleFactory(operator);
        console.log("RatioOracleFactory", address(factory));

        oracle = RatioOracle(factory.createOracle(marketId, settlesAt));
        console.log("oracle", address(oracle));

        address assetA = _createEntry(0, "ratio side A", "RTOA", marketId);
        address assetB = _createEntry(1, "ratio side B", "RTOB", marketId);
        console.log("side A token", assetA);
        console.log("side B token", assetB);

        oracle.setEntryTokens(assetA, assetB);

        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        console.log("swap router", address(router));

        uint256 tokensB = _bet(router, assetB, BET);
        console.log("bet on side B, tokens out", tokensB);
        _bet(router, assetA, BET);
        console.log("bet on side A (the losing side)");

        // Side B wins on likes.
        oracle.declareWinner(1, 120, 900, false);
        console.log("winner declared: side B");

        AIRLOCK.migrate(assetA);
        AIRLOCK.migrate(assetB);
        console.log("both entries migrated; pot (wei)", PREDICTION_MIGRATOR.balance);

        uint256 preview = IPredictionMigrator(PREDICTION_MIGRATOR).previewClaim(address(oracle), tokensB);
        uint256 before = operator.balance;
        IERC20Like(assetB).approve(PREDICTION_MIGRATOR, tokensB);
        IPredictionMigrator(PREDICTION_MIGRATOR).claim(address(oracle), tokensB);

        vm.stopBroadcast();

        console.log("previewClaim  ", preview);
        console.log("balance before", before);
        console.log("balance after ", operator.balance);
        console.log("");
        console.log("=== full lifecycle complete on Base Sepolia ===");
        console.log("oracle       ", address(oracle));
        console.log("side A token ", assetA);
        console.log("side B token ", assetB);
    }

    function _poolInitializerData() internal pure returns (bytes memory) {
        Curve[] memory curves = new Curve[](1);
        curves[0] = Curve({ tickLower: 0, tickUpper: 240_000, numPositions: 10, shares: 1e18 });
        return abi.encode(
            InitData({
                fee: 0,
                tickSpacing: 8,
                // farTick == startTick: migration is gated by the oracle, not by price.
                farTick: 0,
                curves: curves,
                beneficiaries: new BeneficiaryData[](0),
                dopplerHook: NO_SELL_HOOK,
                onInitializationDopplerHookCalldata: "",
                graduationDopplerHookCalldata: ""
            })
        );
    }

    function _createEntry(uint8 side, string memory name, string memory symbol, uint256 marketId)
        internal
        returns (address asset)
    {
        CreateParams memory params = CreateParams({
            initialSupply: 1_000_000 ether,
            numTokensToSell: 1_000_000 ether,
            numeraire: NUMERAIRE,
            tokenFactory: TOKEN_FACTORY,
            // CloneDERC20VotesV2Factory's shape — not the two-uint shape the
            // other factories take. Undocumented; recovered from source.
            tokenFactoryData: abi.encode(
                name,
                symbol,
                uint256(0),
                new VestingSchedule[](0),
                new address[](0),
                new uint256[](0),
                new uint256[](0),
                ""
            ),
            governanceFactory: NO_OP_GOVERNANCE,
            governanceFactoryData: abi.encode(name),
            poolInitializer: HOOK_INITIALIZER,
            poolInitializerData: _poolInitializerData(),
            liquidityMigrator: PREDICTION_MIGRATOR,
            liquidityMigratorData: abi.encode(address(oracle), bytes32(uint256(side))),
            integrator: address(0),
            salt: keccak256(abi.encodePacked(marketId, side))
        });
        (asset,,,,) = AIRLOCK.create(params);
    }

    function _bet(PoolSwapTest router, address asset, uint256 amountIn)
        internal
        returns (uint256 tokensOut)
    {
        uint256 before = IERC20Like(asset).balanceOf(operator);
        router.swap{ value: amountIn }(
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(asset),
                fee: DYNAMIC_FEE_FLAG,
                tickSpacing: 8,
                hooks: IHooks(HOOK_INITIALIZER)
            }),
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
        tokensOut = IERC20Like(asset).balanceOf(operator) - before;
    }
}
