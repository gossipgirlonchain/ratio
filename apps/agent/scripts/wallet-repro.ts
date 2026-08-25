import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const xid = "1318918091116523521";
const r1 = await db.from("wallets").select().eq("x_user_id", xid).maybeSingle();
console.log("select:", JSON.stringify(r1.data), "error:", r1.error?.message ?? "none");
