/**
 * Place a real bet from the viewer's Privy wallet. Auth = Privy bearer
 * token; the source wallet is always the verified viewer's own.
 */
import { NextResponse, type NextRequest } from "next/server";

import { placeRealBet } from "../../../lib/betServer";
import { verifyViewer } from "../../../lib/walletServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // swap build + sign + confirm can take a while

export async function POST(req: NextRequest) {
  const viewer = await verifyViewer(req.headers.get("authorization"));
  if (!viewer) return NextResponse.json({ error: "not logged in" }, { status: 401 });

  const { marketId, side, amountUsd } = (await req.json().catch(() => ({}))) as {
    marketId?: string;
    side?: "a" | "b";
    amountUsd?: number;
  };
  if (!marketId || (side !== "a" && side !== "b") || !Number.isFinite(Number(amountUsd))) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const result = await placeRealBet(viewer, marketId, side, Number(amountUsd));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 300) }, { status: 400 });
  }
}
