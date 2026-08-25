/**
 * The viewer's wallet: address + balance. Auth = Privy bearer token,
 * verified server-side; first call provisions the wallet (same
 * idempotent path as the agent).
 */
import { NextResponse, type NextRequest } from "next/server";

import { balanceUsd, getOrCreateWallet, rentUsd, verifyViewer } from "../../../lib/walletServer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const viewer = await verifyViewer(req.headers.get("authorization"));
  if (!viewer) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  try {
    const wallet = await getOrCreateWallet(viewer.xUserId, viewer.handle);
    const [usd, rent] = await Promise.all([
      balanceUsd(wallet.address).catch(() => 0),
      rentUsd(wallet.address).catch(() => 0),
    ]);
    return NextResponse.json({ address: wallet.address, balanceUsd: usd, rentUsd: rent });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
