# 02 — The live incident, and four corrections

**Given: 2026-09-08 evening and 2026-09-09.** Working messages rather than a
brief. They are recorded because two of them changed the build and one of them
stopped it.

---

## "stop giving days, we need to just full send where we can"

Given 8 September, in response to a status summary written as a day-by-day
plan.

The schedule in `01-corrections-and-decisions.md` stands as a record of intent,
but reporting against it turned working sessions into status meetings, and
every item deferred to a named day was one more thing to hold. The instruction
is to decide reversible things without asking, execute in the session, and
surface only the decisions that are genuinely the human's: arming the agent,
spending real money, anything that posts publicly.

Applied from that point on. The schema cleanup, the demo path, the audit
scripts and the quote rewrite were all done rather than proposed.

## "URGENT THIS SHOULD NOT TRIGGER A BET" / "PAUSE BETTING RIGHT NOW"

Given 9 September, with a screenshot.

@ratiowtf posted a marketing tweet. @Tibug replied to it with the single word
`RATIO`, tagging nobody. The agent — armed on Railway, running a build several
commits behind `main` — opened a market between our own post and that reply,
seeded both sides from the treasury, and posted a card advertising it.

The response, in order:

1. `RATIO_ARMED=0` and the deployment taken down. Betting stopped.
2. The market inspected: $1 + $1 of treasury seed on it, no user money.
3. A wrong fix built and then reverted (see below).
4. The real fix: a market opens when someone TAGS the bot.

The parser had never required the tag. `CREATE_RE` matched the bare word
"ratio", the mentions timeline hands us every reply to our own posts whether it
tags us or not, and `cleaned.length === 0` meant an empty reply created a market
too. All three are the same assumption — that anything reaching the parser was
addressed to us.

## "it can run markets on its own posts"

The correction to the wrong fix.

The first patch made the bot ineligible as a side of any market. That is not
the rule: ratio may be a side, and a market on one of our own posts is
legitimate. The rule that was missing was only ever about the tag. The gate was
reverted the same session.

This is the second time in the week that a plausible-sounding rule was invented
where a specified one already existed. The specified rules win.

## "we need to make sure solana is turned off and make sure eth/base is ready"

Given 9 September, after the incident.

`RATIO_CHAIN` had never been set on Railway, so the live agent had been running
Solana the whole time — the EVM port existed in `main` and nowhere else. Set to
`evm` on both Railway and Vercel, along with the subgraph URL, and production
verified reading its money from the index.
