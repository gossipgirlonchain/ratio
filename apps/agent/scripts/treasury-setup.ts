/** Create (idempotently) the ratio:treasury Privy wallet and print its address. */
import { PrivyWalletProvider } from "../src/privyWallets.js";
const wallets = new PrivyWalletProvider(
  { appId: process.env.PRIVY_APP_ID!, appSecret: process.env.PRIVY_APP_SECRET! },
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);
const w = await wallets.getWallet("ratio:treasury");
console.log("treasury:", w.address);
