import { address } from "@solana/kit";
import { recoverRefs, readOdds } from "@ratio/doppler/pair-market";
import { createClients } from "@ratio/doppler/tx";

const clients = createClients();
const refs = await recoverRefs({
  clients,
  operatorAddress: address("H7VpbRU72x1X8z4kv18YMzSmzcxuTSqCbBiRS3NaDmQV"),
  nonce: 2092248961243627779n,
  labels: ["A @nathan_liow", "B @solana"],
});
console.log("recovered market:", refs.market);
console.log("mints:", refs.outcomes[0].baseMint, refs.outcomes[1].baseMint);
const odds = await readOdds(clients, refs);
console.log("odds impliedA:", odds.implied0, "raised:", odds.raised);
