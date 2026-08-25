import { SupabaseStore } from "../src/storeSupabase.js";
const store = new SupabaseStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const due = await store.listOpenMarketsNeedingLikesSample(300_000, Date.now());
console.log("due markets:", due.map((m) => m.id));
