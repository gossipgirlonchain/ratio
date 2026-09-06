/**
 * The viewer's wallet: address + balance. Auth = Privy bearer token,
 * verified server-side; first call provisions the wallet (same
 * idempotent path as the agent).
 */
import { NextResponse, type NextRequest } from "next/server";

import { marketChain } from "../../../lib/chain";
import { getOrCreateWallet, verifyViewer } from "../../../lib/walletServer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const viewer = await verifyViewer(req.headers.get("authorization"));
  if (!viewer) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  try {
    const chain = await marketChain();
    const wallet = await getOrCreateWallet(viewer.xUserId, viewer.handle);
    const [usd, reserved] = await Promise.all([
      chain.balanceUsd(wallet.address).catch(() => 0),
      chain.reservedUsd(wallet.address).catch(() => 0),
    ]);
    // Wire name stays `rentUsd`: the client and WalletChip speak it, and
    // renaming the response shape is a UI change, not a seam change.
    return NextResponse.json({ address: wallet.address, balanceUsd: usd, rentUsd: reserved });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
