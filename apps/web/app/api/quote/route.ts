/**
 * A real quote, from the curve.
 *
 * Entry is curve-priced: tokens per dollar falls as a side's raise grows, so
 * the payout you should be shown is a TOKEN share of the projected pot, not a
 * money share of it. The linear pot-split formula in `@ratio/ui` is only the
 * small-stake limit of that and it overstates large stakes — the exact place a
 * quote most needs to be right.
 *
 * So the tokens come from simulating the swap on chain, and the denominator
 * comes from the index, because tokens sold per side is a sum over that side's
 * swaps and is readable nowhere else.
 *
 *   payout = tokensOut / (tokensOnYourSide + tokensOut) * (grossPot + stake) * (1 - fee)
 */
import { NextResponse } from "next/server";

import { SWAP_FEE_BPS } from "@ratio/config";
import { coinbaseEthUsd, type EvmMarketChain } from "@ratio/chain/evm";

import { ratioSubgraph } from "../../../lib/subgraph";
import { marketChain } from "../../../lib/chain";

const ethUsd = coinbaseEthUsd();
const WEI = 10n ** 18n;

export const dynamic = "force-dynamic";

const FEE = SWAP_FEE_BPS / 10_000;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    marketId?: string;
    side?: number;
    stakeUsd?: number;
  };
  const { marketId } = body;
  const side = body.side === 1 ? 1 : 0;
  const stakeUsd = Number(body.stakeUsd);
  if (!marketId || !Number.isFinite(stakeUsd) || stakeUsd <= 0) {
    return NextResponse.json({ error: "marketId and a positive stakeUsd are required" }, { status: 400 });
  }

  const sg = ratioSubgraph();
  if (!sg) {
    // No index means no denominator. Say so rather than serving the linear
    // approximation dressed as a chain quote.
    return NextResponse.json({ error: "no index configured" }, { status: 503 });
  }

  try {
    // EVM only: a curve quote is what this route is for, and the Solana
    // implementation prices through its own preview instruction.
    const chain = (await marketChain()) as EvmMarketChain;
    const refs = { marketId };
    const [preview, oracle, rate] = await Promise.all([
      chain.previewStake({ refs, side, stake: { usd: stakeUsd } }),
      chain.oracleFor(marketId),
      ethUsd(),
    ]);
    const totals = await sg.sideTotals(oracle);

    const tokensOut = BigInt(Math.round(preview.tokensOut));
    const denominator = totals.tokens[side] + tokensOut;
    const grossWei = totals.raisedWei[0] + totals.raisedWei[1];
    const stakeWei = BigInt(Math.round((stakeUsd / rate) * 1e18));
    const netPotWei =
      ((grossWei + stakeWei) * BigInt(Math.round((1 - FEE) * 1_000_000))) / 1_000_000n;

    if (tokensOut === 0n) {
      // The curve gave nothing back: the market is finalized, and the hook
      // rejects buys from that point. A zero quote would read as a real
      // answer, so it is refused instead.
      return NextResponse.json({ error: "market is closed to entries" }, { status: 409 });
    }
    const payoutWei = (netPotWei * tokensOut) / denominator;
    const payoutUsd = (Number(payoutWei) / Number(WEI)) * rate;

    return NextResponse.json({
      tokensOut: preview.tokensOut,
      payoutUsd,
      multiple: stakeUsd > 0 ? payoutUsd / stakeUsd : 0,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 200) }, { status: 502 });
  }
}
