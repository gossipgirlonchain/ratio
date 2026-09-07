import assert from "node:assert/strict";

import {
  buildBeneficiaries,
  BeneficiaryError,
  MIN_PROTOCOL_OWNER_SHARES,
  WAD,
  type FeeBeneficiary,
} from "./beneficiaries.js";

// Base Sepolia airlock owner (AirlockMultisigTestnet), verified on chain.
const OWNER = "0x0abCf819FD57C9f0141628410fFC273405E44426";
const TREASURY = "0xfF00000000000000000000000000000000000001";
const AUTHOR_A = "0x1100000000000000000000000000000000000002";
const AUTHOR_B = "0x8800000000000000000000000000000000000003";
const TAGGER = "0x2200000000000000000000000000000000000004";

/** ratio's locked split: doppler 750 / protocol 4500 / A 1800 / B 1800 / tagger 1150. */
const split = (over: Partial<Record<string, string>> = {}): FeeBeneficiary[] => [
  { wallet: over.doppler ?? OWNER, shareBps: 750 },
  { wallet: over.protocol ?? TREASURY, shareBps: 4_500 },
  { wallet: over.sideA ?? AUTHOR_A, shareBps: 1_800 },
  { wallet: over.sideB ?? AUTHOR_B, shareBps: 1_800 },
  { wallet: over.tagger ?? TAGGER, shareBps: 1_150 },
];

const sum = (bs: { shares: bigint }[]) => bs.reduce((s, b) => s + b.shares, 0n);
const ascending = (bs: { beneficiary: string }[]) =>
  bs.every((b, i) => i === 0 || BigInt(bs[i - 1]!.beneficiary) < BigInt(b.beneficiary));

// --- the ordinary case ------------------------------------------------------
{
  const out = buildBeneficiaries(split(), OWNER);
  assert.equal(out.length, 5, "five distinct parties stay five");
  assert.equal(sum(out), WAD, "shares sum to exactly 1e18");
  assert.ok(ascending(out), "addresses strictly ascending");
  const owner = out.find((b) => b.beneficiary === OWNER.toLowerCase())!;
  assert.ok(owner.shares >= MIN_PROTOCOL_OWNER_SHARES, "owner clears the 5% floor");
  assert.equal(owner.shares, 750n * 10n ** 14n, "750 bps == 7.5% of WAD");
}

// --- the tagger is also side B's author: legitimate, and must merge ----------
{
  const out = buildBeneficiaries(split({ tagger: AUTHOR_B }), OWNER);
  assert.equal(out.length, 4, "duplicate wallets merge — four is correct, not a bug");
  assert.equal(sum(out), WAD, "merging must not lose or invent shares");
  assert.ok(ascending(out), "still strictly ascending after merging");
  const stacked = out.find((b) => b.beneficiary === AUTHOR_B.toLowerCase())!;
  assert.equal(stacked.shares, (1_800n + 1_150n) * 10n ** 14n, "slices stack on one wallet");
}

// --- checksum casing is the same payee --------------------------------------
{
  const mixed = split();
  mixed[4] = { wallet: AUTHOR_B.toUpperCase().replace("0X", "0x"), shareBps: 1_150 };
  const out = buildBeneficiaries(mixed, OWNER);
  assert.equal(out.length, 4, "case-different duplicates merge, not slip through");
  assert.ok(ascending(out), "would break Doppler's ascending check if they did");
}

// --- sorting is numeric, not lexicographic ----------------------------------
{
  // "0x9..." < "0x10..." as strings, but 0x9... > 0x10... as numbers.
  const out = buildBeneficiaries(
    [
      { wallet: OWNER, shareBps: 5_000 },
      { wallet: "0x9000000000000000000000000000000000000000", shareBps: 2_500 },
      { wallet: "0x1000000000000000000000000000000000000000", shareBps: 2_500 },
    ],
    OWNER,
  );
  assert.ok(ascending(out), "numeric ordering, never string ordering");
  assert.equal(out[0]!.beneficiary, "0x0abcf819fd57c9f0141628410ffc273405e44426");
}

// --- the airlock owner is mandatory on EVM ----------------------------------
{
  assert.throws(
    () => buildBeneficiaries(split({ doppler: TREASURY }), OWNER),
    BeneficiaryError,
    "omitting the airlock owner must fail loudly, not at create() time",
  );
}

// --- and must clear 5% ------------------------------------------------------
{
  assert.throws(
    () =>
      buildBeneficiaries(
        [
          { wallet: OWNER, shareBps: 400 }, // 4% — under the floor
          { wallet: TREASURY, shareBps: 9_600 },
        ],
        OWNER,
      ),
    BeneficiaryError,
    "under 500 bps must be refused",
  );
  // exactly 5% is allowed
  const edge = buildBeneficiaries(
    [
      { wallet: OWNER, shareBps: 500 },
      { wallet: TREASURY, shareBps: 9_500 },
    ],
    OWNER,
  );
  assert.equal(edge.find((b) => b.beneficiary === OWNER.toLowerCase())!.shares, MIN_PROTOCOL_OWNER_SHARES);
}

// --- totals and shapes ------------------------------------------------------
{
  assert.throws(
    () => buildBeneficiaries([{ wallet: OWNER, shareBps: 9_999 }], OWNER),
    BeneficiaryError,
    "must sum to 10000 bps",
  );
  assert.throws(
    () => buildBeneficiaries([{ wallet: OWNER, shareBps: 0 }], OWNER),
    BeneficiaryError,
    "zero shares are rejected by Doppler, so reject them here",
  );
  assert.throws(
    () => buildBeneficiaries([{ wallet: "not-an-address", shareBps: 10_000 }], OWNER),
    BeneficiaryError,
    "malformed addresses",
  );
}

// --- no rounding drift at any legal split -----------------------------------
{
  for (let a = 500; a <= 9_500; a += 137) {
    const out = buildBeneficiaries(
      [
        { wallet: OWNER, shareBps: a },
        { wallet: TREASURY, shareBps: 10_000 - a },
      ],
      OWNER,
    );
    assert.equal(sum(out), WAD, `bps->WAD must be exact at owner=${a}`);
  }
}

console.log("beneficiaries ✅");
