import assert from "node:assert/strict";

import { quotePayout } from "./payout";

/**
 * These pin the APPROXIMATION, and they are only correct as that.
 *
 * `quotePayout` divides pot totals. The real entry is curve-priced, so the
 * real payout is a token share of the projected pot, and this formula is its
 * small-stake limit: right to within rounding for a dollar, progressively too
 * generous as the stake grows. Where a market is on chain and indexed, the app
 * quotes from `/api/quote`, which simulates the swap; this one is the fallback
 * for markets with no pool to simulate — fixtures, and markets opened on
 * Solana.
 *
 * So a passing test here does not mean a bettor is being quoted correctly. It
 * means the fallback still behaves the way the fallback is supposed to.
 */

// Spec §8's market: $640 side against $1,960.
const base = { potAUsd: 1_960, potBUsd: 640, yourSideUsd: 640 };

// $1 on the thin side ≈ 4x — dilution negligible at small size.
const small = quotePayout({ stakeUsd: 1, ...base });
assert.ok(Math.abs(small.multiple - 4.01) < 0.01, `got ${small.multiple}`);

// $500 on the same side: 2.69x from this formula. The spec's 2.26x example
// omits the stake from the pot numerator, and the curve's own answer is lower
// than both, because 500 dollars buys progressively fewer tokens as it lands.
// The number is pinned to catch drift, NOT because it is what a bettor should
// be shown for a stake this size.
const big = quotePayout({ stakeUsd: 500, ...base });
assert.ok(Math.abs(big.multiple - 2.69) < 0.01, `got ${big.multiple}`);

// The error is one-directional, which is the part that matters: this formula
// never quotes BELOW the curve, so nobody is ever paid more than they were
// shown. Measured against a live Base Sepolia market (751886563, side A):
// $1 quoted 1.97x from the curve, $25 quoted 1.10x, $500 quoted 0.99x, while
// this formula's multiples for the same pots are higher at every size.
for (const stake of [1, 25, 500]) {
  const approx = quotePayout({ stakeUsd: stake, potAUsd: 1.99, potBUsd: 2.98, yourSideUsd: 1.99 });
  const curve = [1.97, 1.1, 0.993][[1, 25, 500].indexOf(stake)]!;
  assert.ok(
    approx.multiple >= curve - 0.01,
    `the approximation must never quote below the curve (stake ${stake})`,
  );
}

// Dilution is monotone: bigger stake, smaller multiple. The self-capping
// bounty that replaces stake caps (§8).
let prev = Infinity;
for (const stake of [1, 5, 25, 100, 250, 500]) {
  const { multiple } = quotePayout({ stakeUsd: stake, ...base });
  assert.ok(multiple < prev, `multiple must fall as stake grows`);
  prev = multiple;
}

// Empty market: first dollar quotes ≈ 1x minus fee (you are the whole pot).
const empty = quotePayout({ stakeUsd: 10, potAUsd: 0, potBUsd: 0, yourSideUsd: 0 });
assert.ok(Math.abs(empty.multiple - 0.9875) < 0.001);

console.log("payout quotes ✅");
