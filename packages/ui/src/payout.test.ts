import assert from "node:assert/strict";

import { quotePayout } from "./payout";

// Spec §8's market: $640 side against $1,960.
const base = { potAUsd: 1_960, potBUsd: 640, yourSideUsd: 640 };

// $1 on the thin side ≈ 4x — dilution negligible at small size.
const small = quotePayout({ stakeUsd: 1, ...base });
assert.ok(Math.abs(small.multiple - 4.01) < 0.01, `got ${small.multiple}`);

// $500 on the same side: the formula as written (own stake joins the pot)
// gives 2.69x. The spec's 2.26x example omits the stake from the pot
// numerator; flagged in payout.ts — the on-chain curve truth sits between.
const big = quotePayout({ stakeUsd: 500, ...base });
assert.ok(Math.abs(big.multiple - 2.69) < 0.01, `got ${big.multiple}`);

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
