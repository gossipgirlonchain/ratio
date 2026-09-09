import assert from "node:assert/strict";

import { parseMention } from "./parse.js";

const bet = (text: string) => {
  const r = parseMention(text, "ratiowtf");
  assert.equal(r.action, "bet", `expected a bet from ${JSON.stringify(text)}, got ${r.action}`);
  return r as Extract<ReturnType<typeof parseMention>, { action: "bet" }>;
};

// --- dollars: a leading $ is the only thing that means USD ------------------
{
  for (const text of ["@ratiowtf $25 @cora", "@ratiowtf @cora $25", "@ratiowtf $25 on @cora"]) {
    const r = bet(text);
    assert.equal(r.amount, 25, text);
    assert.equal(r.unit, "usd", text);
    assert.deepEqual(r.side, { handle: "cora" }, text);
  }
  const decimal = bet("@ratiowtf $12.50 @cora");
  assert.equal(decimal.amount, 12.5);
  assert.equal(decimal.unit, "usd");
}

// --- ETH: bare numbers, and explicit suffixes -------------------------------
{
  for (const text of ["@ratiowtf 0.01 @cora", "@ratiowtf @cora 0.01", "@ratiowtf 0.01 on @cora"]) {
    const r = bet(text);
    assert.equal(r.amount, 0.01, text);
    assert.equal(r.unit, "eth", text);
    assert.deepEqual(r.side, { handle: "cora" }, text);
  }
  for (const text of ["@ratiowtf 0.05 eth @cora", "@ratiowtf 0.05 ETH @cora", "@ratiowtf 0.05Ξ @cora"]) {
    const r = bet(text);
    assert.equal(r.amount, 0.05, text);
    assert.equal(r.unit, "eth", text);
  }
}

// --- the ambiguous case fails SAFE ------------------------------------------
{
  // A bare "25" reads as 25 ETH. That is far above the cap, so it is refused —
  // the failure is a rejected bet, never one a hundred times too big.
  const r = bet("@ratiowtf 25 @cora");
  assert.equal(r.unit, "eth", "bare numbers are ETH, so an over-cap value is refused");
  assert.equal(r.amount, 25);
}

// --- the letter fallback keeps both units -----------------------------------
{
  const usd = bet("@ratiowtf $25 on A");
  assert.equal(usd.side, 0);
  assert.equal(usd.unit, "usd");
  assert.equal(usd.amount, 25);

  const eth = bet("@ratiowtf 0.01 on B");
  assert.equal(eth.side, 1);
  assert.equal(eth.unit, "eth");
  assert.equal(eth.amount, 0.01);

  const reversed = bet("@ratiowtf B 0.02");
  assert.equal(reversed.side, 1);
  assert.equal(reversed.unit, "eth");
  assert.equal(reversed.amount, 0.02);
}

// --- the bug the original file warns about, still fixed ---------------------
{
  // Without \b on both sides of the letter, "$25" parses as side "2" amount 5.
  // That routed money to the wrong side, so it is pinned here permanently.
  const r = bet("@ratiowtf $25 on A");
  assert.equal(r.side, 0, "$25 must not parse as side 2 amount 5");
  assert.equal(r.amount, 25);
}

// --- the bot's own handle is never a side -----------------------------------
{
  const r = bet("@ratiowtf $25 @cora");
  assert.deepEqual(r.side, { handle: "cora" }, "the bot tag must be stripped first");
}

// --- non-bets ---------------------------------------------------------------
{
  assert.equal(parseMention("@ratiowtf", "ratiowtf").action, "create");
  assert.equal(parseMention("@ratiowtf ratio this", "ratiowtf").action, "create");
  assert.equal(parseMention("@ratiowtf what even is this", "ratiowtf").action, "ignore");
  assert.equal(parseMention("@ratiowtf $0 @cora", "ratiowtf").action, "ignore", "zero is not a bet");
}

// --- no tag, no market -------------------------------------------------------
{
  // 9 September: @Tibug replied "RATIO" to one of our own posts, tagging
  // nobody, and a market opened between our post and that reply. The mentions
  // timeline hands us every reply to our posts; the word "ratio" in one of
  // them is not a request for anything.
  assert.equal(parseMention("RATIO", "ratiowtf").action, "ignore", "an untagged reply is not a create");
  assert.equal(parseMention("ratio this guy", "ratiowtf").action, "ignore");
  assert.equal(parseMention("market", "ratiowtf").action, "ignore");
  assert.equal(parseMention("", "ratiowtf").action, "ignore", "an empty reply is not a create");
  assert.equal(parseMention("open", "ratiowtf").action, "ignore");

  // Still a create when the tag is actually there.
  assert.equal(parseMention("@ratiowtf RATIO", "ratiowtf").action, "create");
  assert.equal(parseMention("@RatioWTF", "ratiowtf").action, "create", "tag matching is case-insensitive");

  // A stake stays valid untagged: it names an amount, and it does nothing
  // unless it is a reply to a live market card.
  const untagged = parseMention("$25 @cora", "ratiowtf");
  assert.equal(untagged.action, "bet", "an untagged stake on a card is still a stake");
}

console.log("parse ✅");
