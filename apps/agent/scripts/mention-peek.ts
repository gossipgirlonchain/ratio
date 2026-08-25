import { XApiClient } from "../src/xApi.js";
async function main() {
  const c = new XApiClient({ apiKey: process.env.X_API_KEY!, apiSecret: process.env.X_API_SECRET!, accessToken: process.env.X_ACCESS_TOKEN!, accessSecret: process.env.X_ACCESS_SECRET!, botUserId: "2086696636579778560" });
  const m = await c.fetchMentions();
  console.log(m.length, "mention(s)");
  for (const x of m) console.log("-", x.mentionTweetId, "@" + x.authorHandle, JSON.stringify(x.text.slice(0, 40)), "target:", x.target?.type, x.target?.tweetId);
  const t = await c.getTweet("2092022178460192862");
  console.log("winny's tag tweet:", t ? `exists by @${t.authorHandle}` : "GONE");
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
