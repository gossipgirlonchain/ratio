/**
 * Send from the viewer's wallet. Auth = Privy bearer token; the wallet
 * can only ever be the verified viewer's own — no address parameter is
 * accepted for the source, by design.
 */
import { NextResponse, type NextRequest } from "next/server";

import { marketChain } from "../../../../lib/chain";
import { getOrCreateWallet, verifyViewer } from "../../../../lib/walletServer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const viewer = await verifyViewer(req.headers.get("authorization"));
  if (!viewer) return NextResponse.json({ error: "not logged in" }, { status: 401 });

  const chain = await marketChain();
  const { to, amountUsd } = (await req.json().catch(() => ({}))) as {
    to?: string;
    amountUsd?: number;
  };
  if (!to || !chain.isValidAddress(to)) {
    return NextResponse.json({ error: "that is not a valid address" }, { status: 400 });
  }
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
    return NextResponse.json({ error: "bad amount" }, { status: 400 });
  }

  try {
    const wallet = await getOrCreateWallet(viewer.xUserId, viewer.handle);
    const balance = await chain.balanceUsd(wallet.address);
    // fee headroom: a send that drains to exactly zero fails on gas
    if (amount > balance - 0.01) {
      return NextResponse.json({ error: "not enough in the wallet" }, { status: 400 });
    }
    const { signature } = await chain.transferUsd({
      from: wallet.address,
      to,
      amountUsd: amount,
    });
    return NextResponse.json({ signature });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 200) }, { status: 500 });
  }
}
