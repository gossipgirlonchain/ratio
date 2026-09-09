/**
 * The ratio engine: mention -> pair resolution -> eligibility -> market ->
 * 24h settlement on absolute like counts.
 *
 * Flow rules (spec):
 *   - side B = the reply/QT, side A = the tweet it references; one code path
 *   - anyone can tag; no allowlist; rejected mentions get ONE reply, never retried
 *   - higher absolute like count at created_at + 24h wins; exact tie -> side A
 *   - no voids: an unreadable side (deleted/suspended/private/blocked)
 *     FORFEITS at settlement time; treasury seeds $1/side at creation so a
 *     moneyless winning side cannot exist
 *   - likes sampler cron records the chart's likes series
 *
 * Ported from cue-wire verbatim where the spec says to: mention idempotency,
 * late-stake rejection, min/max caps, the pre-migration odds snapshot, the
 * one-linked-post cost policy.
 */

import {
  betConfirm,
  duplicatePointer,
  insufficientFunds,
  hiddenNotice,
  marketCard,
  recap,
  rejection,
  forfeitRecap,
  type RejectionReason,
} from "@ratio/config/copy";
import type { FeeBeneficiary, MarketChain, Stake } from "@ratio/chain";

import { parseMention, substantiveText } from "./parse.js";
import type { MarketRecord, PairType, Store } from "./store.js";
import type { WalletProvider } from "./wallets.js";
import type { XClient, XMention, XTweet } from "./x.js";

export interface EngineConfig {
  botHandle: string;
  freshnessWindowMs: number; // side B under this old at mention time
  marketDurationMs: number; // 24h
  seedPerSideUsd: number; // treasury seed per side at creation
  likesSampleIntervalMs: number; // chart likes-series cadence
  minStakeUsd: number;
  maxStakeUsd: number;
  /** Independent reporters required before the hidden badge goes live. */
  hiddenReportThreshold: number;
  protocolWallet: string;
  /** Five-party split of the swap fee — confirmed, immutable once curves launch. */
  feeShareBps: {
    doppler: number;
    tagger: number;
    sideA: number;
    sideB: number;
    protocol: number;
  };
  dopplerWallet: string;
  marketUrl: (marketId: string) => string;
  now: () => number;
}

interface ResolvedPair {
  sideA: XTweet;
  sideB: XTweet;
  pairType: PairType;
}

export class RatioEngine {
  constructor(
    private readonly x: XClient,
    private readonly store: Store,
    private readonly wallets: WalletProvider,
    private readonly chain: MarketChain,
    private readonly config: EngineConfig,
  ) {}

  /** One poll-loop tick: fetch mentions, act on each exactly once. */
  async tick(): Promise<void> {
    const mentions = await this.x.fetchMentions();
    for (const mention of mentions) {
      const fresh = await this.store.markMentionProcessed(mention.mentionTweetId);
      if (!fresh) continue; // idempotency: polling re-shows mentions
      try {
        await this.handleMention(mention);
      } catch (err) {
        console.error(
          `  mention ${mention.mentionTweetId} failed:`,
          (err as Error).message,
        );
      }
    }
  }

  private async handleMention(mention: XMention): Promise<void> {
    const intent = parseMention(mention.text, this.config.botHandle);
    if (intent.action === "ignore") return; // read cost only, never reply to noise

    if (intent.action === "bet") {
      if (!mention.target) return;
      const record = await this.store.getMarketByTweet(mention.target.tweetId);
      if (!record || record.status !== "open") return;
      if (this.config.now() >= record.settlesAtMs) {
        console.log(`  (stake from @${mention.authorHandle} too late — market closed)`);
        return; // skip silently: no reply spend on late stakes
      }
      // Handle-based stakes resolve against the market's cached handles.
      // Handles are display cache (identity = numeric id); a handle change
      // between creation and stake makes the stake unresolvable, which
      // fails SAFE: skip silently, money never routes on a stale name.
      let side: 0 | 1;
      if (typeof intent.side === "object") {
        const h = intent.side.handle.toLowerCase();
        if (h === record.authorAHandle.toLowerCase()) side = 0;
        else if (h === record.authorBHandle.toLowerCase()) side = 1;
        else {
          console.log(
            `  (stake from @${mention.authorHandle} names @${intent.side.handle} — not a side here, skipped)`,
          );
          return;
        }
      } else {
        side = intent.side;
      }
      const stake: Stake =
        intent.unit === "usd" ? { usd: intent.amount } : { native: intent.amount };
      await this.placeBet(mention, record, side, stake);
      return;
    }

    await this.createMarket(mention);
  }

  // -------------------------------------------------------------------------
  // Pair resolution — one code path for both qualifying shapes
  // -------------------------------------------------------------------------

  /**
   * Rules, in order:
   *  1. Mention's target is itself a reply/QT  -> side B = target,
   *     side A = target's referenced tweet. (Scout path, primary.)
   *  2. Target is standalone but the mention tweet QUOTES it -> the mention
   *     tweet is side B, target is side A. (Author path: tag embedded in
   *     your own QT.)
   *  3. Same for a reply-shaped mention, but only when the mention carries a
   *     take beyond the tag — a bare "@bot" reply to a standalone tweet is a
   *     trigger with nothing to pair, not a side B.
   */
  private async resolvePair(
    mention: XMention,
  ): Promise<ResolvedPair | RejectionReason> {
    if (!mention.target) return "not_reply_or_quote";
    const target = await this.x.getTweet(mention.target.tweetId);
    if (!target) return "unreadable";

    if (target.referencedTweet) {
      const sideA = await this.x.getTweet(target.referencedTweet.tweetId);
      if (!sideA) return "unreadable";
      return {
        sideA,
        sideB: target,
        pairType: target.referencedTweet.type === "quoted" ? "quote" : "reply",
      };
    }

    // Target is standalone: the mention tweet itself may be side B.
    const isQuote = mention.target.type === "quoted";
    if (!isQuote && substantiveText(mention.text).length === 0)
      return "not_reply_or_quote";
    const mentionTweet = await this.x.getTweet(mention.mentionTweetId);
    if (!mentionTweet) return "unreadable";
    return {
      sideA: target,
      sideB: mentionTweet,
      pairType: isQuote ? "quote" : "reply",
    };
  }

  private async createMarket(mention: XMention): Promise<void> {
    const now = this.config.now();
    const pair = await this.resolvePair(mention);

    const reject = async (reason: RejectionReason) => {
      console.log(`  rejected ${mention.mentionTweetId}: ${reason}`);
      try {
        await this.x.postReply({
          inReplyTo: mention.mentionTweetId,
          text: rejection(reason, this.config.botHandle),
        });
      } catch (err) {
        // X dedups identical text account-wide; a rejection we already
        // voiced once is delivered as far as we care. Anything else rethrows.
        if (!(err as Error).message.includes("duplicate content")) throw err;
        console.log(`  rejection reply deduped by X (already posted once)`);
      }
    };

    if (typeof pair === "string") return reject(pair);
    const { sideA, sideB, pairType } = pair;

    // Eligibility gate — all required.
    if (sideA.authorId === sideB.authorId) return reject("same_author");
    // No markets on your own post: the tagger cannot be side A's author.
    // Tagger = side B's author IS allowed ("my reply beats your tweet") and
    // legitimately stacks the tagger and side B fee slices.
    if (mention.authorId === sideA.authorId) return reject("own_post");
    const age = now - sideB.createdAtMs;
    if (age >= this.config.freshnessWindowMs) return reject("too_old");
    const existing = await this.store.getMarketByPair(sideA.tweetId, sideB.tweetId);
    if (existing) {
      // Convert, don't reject: link straight to the live market.
      await this.x.postReply({
        inReplyTo: mention.mentionTweetId,
        text: duplicatePointer(),
        link: this.config.marketUrl(existing.id),
      });
      return;
    }

    // Every fee recipient gets a wallet at creation, used-the-product or not
    // (unclaimed balances are the acquisition hook — R4 wires notifications).
    const [tagger, walletA, walletB] = await Promise.all([
      this.wallets.getWallet(mention.authorId),
      this.wallets.getWallet(sideA.authorId),
      this.wallets.getWallet(sideB.authorId),
    ]);
    const share = this.config.feeShareBps;
    // The initializer rejects DUPLICATE beneficiary wallets
    // (InvalidFeeBeneficiary). Duplicates are legitimate here — tagger =
    // side B's author stacks slices by design — so merge shares per
    // wallet instead of listing a wallet twice.
    const merged = new Map<string, number>();
    for (const [wallet, bps] of [
      [this.config.dopplerWallet, share.doppler],
      [tagger.address, share.tagger],
      [walletA.address, share.sideA],
      [walletB.address, share.sideB],
      [this.config.protocolWallet, share.protocol],
    ] as Array<[string, number]>) {
      merged.set(wallet, (merged.get(wallet) ?? 0) + bps);
    }
    const feeBeneficiaries: FeeBeneficiary[] = [...merged.entries()].map(
      ([wallet, shareBps]) => ({ wallet, shareBps }),
    );

    console.log(
      `  launching @${sideA.authorHandle} vs @${sideB.authorHandle} (nonce ${sideB.tweetId})…`,
    );
    // Hard timeout: a hung launch must throw (and log) instead of
    // silently freezing the mention cron forever.
    const chainRefs = await Promise.race([
      this.chain.createMarket({
        nonce: sideB.tweetId,
        feeBeneficiaries,
        outcomes: [`A @${sideA.authorHandle}`, `B @${sideB.authorHandle}`],
        // The same value stored on the record below, so the contract and our
        // database agree on the deadline to the millisecond.
        settlesAtMs: now + this.config.marketDurationMs,
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("chain launch timed out after 5min")), 300_000),
      ),
    ]);
    console.log(`  launch landed: ${chainRefs.marketId}`);

    const record: MarketRecord = {
      id: sideB.tweetId,
      tweetAId: sideA.tweetId,
      tweetBId: sideB.tweetId,
      authorAXId: sideA.authorId,
      authorBXId: sideB.authorId,
      taggerXId: mention.authorId,
      pairType,
      bSelectedBy: "tagger",
      createdAtMs: now,
      settlesAtMs: now + this.config.marketDurationMs,
      tweetBAgeAtCreateMs: age,
      likesAAtCreate: sideA.likeCount,
      likesBAtCreate: sideB.likeCount,
      status: "open",
      winner: null,
      hiddenReporterIds: [],
      hiddenReportCount: 0,
      chainRefs,
      authorAHandle: sideA.authorHandle,
      authorBHandle: sideB.authorHandle,
      taggerHandle: mention.authorHandle,
      textA: sideA.text,
      textB: sideB.text,
    };
    await this.store.saveMarket(record);

    // NO SEED AT CREATION. It used to buy $1 on each side here, to guarantee
    // a holder on the winning side so settlement could never divide by zero.
    // But the LOSING side's seed always ends up distributed to the winners,
    // which is a standing subsidy on every market — and opening a market is
    // free, so anyone who can influence a like count farms it.
    //
    // The guarantee is now bought at SETTLEMENT instead, and only when it is
    // actually needed. See resolveMarket.

    // The ONE linked post per market — the market card, a QUOTE TWEET of
    // side A (card spec 2026-08-25: the quoted tweet is its own context,
    // the copy never describes it). The example handle on line 3 is
    // always the quoted author, so a copy-paste reply is a valid bet on
    // the tweet the reader sees. Restricted accounts can block quoting
    // too: fall back to quoting side B, then to a reply on the mention.
    const link = this.config.marketUrl(record.id);
    const closesInMs = record.settlesAtMs - now;
    const cardFor = (quoted: XTweet, opponent: XTweet) =>
      marketCard({
        quotedHandle: quoted.authorHandle,
        opponentHandle: opponent.authorHandle,
        closesInMs,
      });
    const restricted = (err: unknown) =>
      (err as Error).message.includes("not-authorized-for-resource");
    let card: { tweetId: string };
    try {
      card = await this.x.postQuote({
        quoteTweetId: sideA.tweetId,
        text: cardFor(sideA, sideB),
        link,
      });
    } catch (errA) {
      if (!restricted(errA)) throw errA;
      console.log(`  side A quote-restricted; card quotes side B`);
      try {
        card = await this.x.postQuote({
          quoteTweetId: sideB.tweetId,
          text: cardFor(sideB, sideA),
          link,
        });
      } catch (errB) {
        if (!restricted(errB)) throw errB;
        console.log(`  both sides quote-restricted; card replies to the mention`);
        card = await this.x.postReply({
          inReplyTo: mention.mentionTweetId,
          text: cardFor(sideA, sideB),
          link,
        });
      }
    }
    await this.store.updateMarket(record.id, { cardTweetId: card.tweetId });
  }

  private async placeBet(
    mention: XMention,
    record: MarketRecord,
    side: 0 | 1,
    stake: Stake,
  ): Promise<void> {
    const { config } = this;
    // The min/max policy stays in dollars whichever unit they typed, so a cap
    // means the same thing to everyone. Asking the chain keeps the rate in one
    // place rather than giving the engine its own opinion about prices.
    const amountUsd = await this.chain.stakeUsd(stake);
    if (amountUsd < config.minStakeUsd) return; // below min: no reply spend

    // Over the cap we do NOT silently shrink a native-denominated stake: "0.5"
    // meaning half an ETH is more likely a typo than an intent to bet the max,
    // and quietly placing the cap instead would be putting words in their
    // mouth. Dollar stakes keep the old forgiving behaviour.
    let capped = stake;
    if (amountUsd > config.maxStakeUsd) {
      if ("usd" in stake) capped = { usd: config.maxStakeUsd };
      else {
        console.log(
          `  (stake from @${mention.authorHandle} is ~$${amountUsd.toFixed(0)}, over the $${config.maxStakeUsd} cap — skipped)`,
        );
        return;
      }
    }
    const cappedUsd = await this.chain.stakeUsd(capped);

    const bettor = await this.wallets.getWallet(mention.authorId);
    // Broke check BEFORE the chain call: a failed swap is silent, but a
    // person trying to bet deserves to hear how to get in. 0.05 headroom
    // covers fees and rent.
    const balance = await this.chain.balanceUsd(bettor.address);
    if (balance < cappedUsd + 0.05) {
      await this.x.postReply({
        inReplyTo: mention.mentionTweetId,
        text: insufficientFunds(mention.authorHandle),
      });
      return;
    }
    const result = await this.chain.placeBet({
      refs: record.chainRefs,
      side,
      stake: capped,
      bettor: bettor.address,
    });
    await this.store.saveBet({
      marketId: record.id,
      xUserId: mention.authorId,
      handle: mention.authorHandle,
      side,
      amountUsd: cappedUsd,
      direction: "buy", // reply-stakes only buy; sells are an app-surface action
      tokensOut: result.tokensOut,
      placedAtMs: config.now(),
    });

    const odds = await this.chain.getOdds(record.chainRefs);
    await this.x.postReply({
      inReplyTo: mention.mentionTweetId,
      text: betConfirm({
        handle: mention.authorHandle,
        amountUsd: cappedUsd,
        backedHandle: side === 0 ? record.authorAHandle : record.authorBHandle,
        sideAHandle: record.authorAHandle,
        impliedAPct: Math.round(odds.impliedA * 100),
      }),
    });
  }

  // -------------------------------------------------------------------------
  // Hidden-reply badge — extension-sourced, display only
  // -------------------------------------------------------------------------

  /**
   * An extension client reports side B missing from its thread. This is a
   * DISPLAY FLAG, never an input to settlement: markets resolve purely on
   * absolute like counts whether or not the badge is live. A false positive
   * costs a wrong label, not a wrong payout — which is exactly why
   * client-sourced data is acceptable here and nowhere else.
   *
   * The badge goes live once `hiddenReportThreshold` INDEPENDENT reporters
   * corroborate; the bot then posts the notice once. QTs cannot be hidden,
   * so only reply markets accept reports.
   */
  async reportHidden(marketId: string, reporterId: string): Promise<void> {
    const record = await this.store.getMarketByTweet(marketId);
    if (!record || record.status !== "open") return;
    if (record.pairType !== "reply") return;
    if (record.hiddenReporterIds.includes(reporterId)) return; // dedupe

    const hiddenReporterIds = [...record.hiddenReporterIds, reporterId];
    const patch: Partial<MarketRecord> = {
      hiddenReporterIds,
      hiddenReportCount: hiddenReporterIds.length,
    };
    const crossedThreshold =
      record.hiddenReportedAtMs === undefined &&
      hiddenReporterIds.length >= this.config.hiddenReportThreshold;
    if (crossedThreshold) patch.hiddenReportedAtMs = this.config.now();
    await this.store.updateMarket(record.id, patch);

    if (crossedThreshold) {
      // The recap the collaborators wanted: observation-worded, once, in our
      // own thread (the hidden reply's thread placement is exactly what is
      // in question, so the card is the anchor).
      await this.x.postReply({
        inReplyTo: record.cardTweetId ?? record.tweetBId,
        text: hiddenNotice(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Crons
  // -------------------------------------------------------------------------

  /**
   * Likes sampler (replaced the void health check, 2026-08-11): the chart's
   * likes series exists nowhere else, so open markets get their counts
   * recorded every interval. Unreadable sides are NOT acted on here —
   * forfeits are decided at settlement time, because suspensions and
   * privacy flips can reverse before the clock runs out.
   */
  async sampleLikesDueMarkets(): Promise<void> {
    const now = this.config.now();
    const due = await this.store.listOpenMarketsNeedingLikesSample(
      this.config.likesSampleIntervalMs,
      now,
    );
    for (const record of due) {
      try {
        const [a, b] = await Promise.all([
          this.x.getTweet(record.tweetAId),
          this.x.getTweet(record.tweetBId),
        ]);
        // Mark sampled only after a successful read: a transient failure
        // leaves the cadence untouched so the next tick retries.
        await this.store.updateMarket(record.id, { lastLikesSampleAtMs: now });
        if (a && b) {
          await this.store.saveLikeSample({
            marketId: record.id,
            atMs: now,
            likesA: a.likeCount,
            likesB: b.likeCount,
          });
        }
        // One side unreadable: no sample, no action — settlement decides.
      } catch (err) {
        console.error(
          `  likes sample ${record.id} deferred:`,
          (err as Error).message,
        );
      }
    }
  }

  /** Settlement cron: absolute like counts, tie goes to side A. */
  async resolveDueMarkets(): Promise<void> {
    const due = await this.store.listOpenMarketsDue(this.config.now());
    for (const record of due) {
      try {
        await this.resolveMarket(record);
      } catch (err) {
        // Transient failure (X API, RPC): the market stays open and the next
        // cron tick retries. Voids happen only on definitive unreadability.
        console.error(
          `  settlement ${record.id} deferred:`,
          (err as Error).message,
        );
      }
    }
  }

  private async resolveMarket(record: MarketRecord): Promise<void> {
    const [a, b] = await Promise.all([
      this.x.getTweet(record.tweetAId),
      this.x.getTweet(record.tweetBId),
    ]);

    // An unreadable side (deleted, suspended, private, blocked) FORFEITS:
    // nobody deletes their way out of losing. Decided at settlement time —
    // suspensions can reverse mid-window. Both unreadable: the original
    // holds by the same convention as an exact tie.
    const forfeit = !a || !b;
    const winner: "a" | "b" = forfeit
      ? a
        ? "a"
        : b
          ? "b"
          : "a"
      : b!.likeCount > a!.likeCount
        ? "b"
        : "a";
    const winnerSide: 0 | 1 = winner === "a" ? 0 : 1;

    // Last-known counts for the record when a side is gone (creation
    // snapshot is the floor; the sampler usually has something fresher).
    const samples = await this.store.listLikeSamples(record.id);
    const lastSample = samples.at(-1);
    const likesA = a?.likeCount ?? lastSample?.likesA ?? record.likesAAtCreate;
    const likesB = b?.likeCount ?? lastSample?.likesB ?? record.likesBAtCreate;

    // Snapshot BEFORE settle: vaults drain at migration, and the recap is
    // the distribution loop — without this it has nothing to say.
    const snapshotOdds = await this.chain.getOdds(record.chainRefs);

    // Nobody backed the winner. On-chain that is fatal rather than awkward:
    // claimableSupply is zero, the claim divides by zero, and the whole pot is
    // stranded with no refund path — sells are impossible and the migrator has
    // no refund instruction.
    //
    // So the treasury buys the minimum on the winning side, here, once the
    // result is known. Doing it now rather than at creation is what makes it
    // unfarmable: the market has already closed, so nobody can bet alongside
    // the rescue to capture it. The consequence, stated plainly because it is
    // real money: the treasury then holds the only winning tokens and claims
    // the pot. A market nobody backed correctly goes to the house.
    let odds = snapshotOdds;
    if (odds.raisedUsd[winnerSide] === 0) {
      console.log(
        `  market ${record.id}: nobody backed the winning side — treasury seeding $${this.config.seedPerSideUsd} to make it settleable`,
      );
      try {
        const rescue = await this.chain.placeBet({
          refs: record.chainRefs,
          side: winnerSide,
          stake: { usd: this.config.seedPerSideUsd },
          bettor: this.config.protocolWallet,
        });
        await this.store.saveBet({
          marketId: record.id,
          xUserId: "ratio:treasury",
          handle: "ratio",
          side: winnerSide,
          direction: "buy",
          amountUsd: this.config.seedPerSideUsd,
          tokensOut: rescue.tokensOut,
          placedAtMs: this.config.now(),
          isSeed: true,
        });
        // Re-read: the snapshot has to include the rescue, or the recap and
        // the fee card describe a smaller pot than the one being paid out.
        odds = await this.chain.getOdds(record.chainRefs);
      } catch (err) {
        // Better a market held open and retried next tick than one finalized
        // into a pot nobody can ever claim.
        console.error(
          `  rescue seed failed for ${record.id}, settlement deferred: ${(err as Error).message.slice(0, 160)}`,
        );
        return;
      }
    }

    // Snapshot AFTER any rescue, and before settle: the vaults drain at
    // migration, so this is the last moment the pot is readable — and it must
    // be the pot that is actually paid out, rescue included.
    const snapshot = {
      likesAFinal: likesA,
      likesBFinal: likesB,
      finalImpliedA: odds.impliedA,
      finalPotUsd: odds.raisedUsd[0] + odds.raisedUsd[1],
    };

    await this.chain.settle({ refs: record.chainRefs, winner: winnerSide });
    await this.store.updateMarket(record.id, {
      status: forfeit ? "forfeited" : "settled",
      winner,
      ...snapshot,
    });

    // Custodial payout: winning must not require a claim button. Every
    // distinct winning-side bettor gets claimed for, payout unwrapped to
    // native SOL in their wallet. Failures log loudly and never block the
    // recap; the tokens stay claimable by a rerun.
    const bets = await this.store.listBets(record.id);
    const winnersSeen = new Set<string>();
    for (const bet of bets) {
      if (bet.side !== winnerSide || winnersSeen.has(bet.xUserId)) continue;
      winnersSeen.add(bet.xUserId);
      try {
        const bettor =
          bet.xUserId === "ratio:treasury"
            ? this.config.protocolWallet
            : (await this.wallets.getWallet(bet.xUserId)).address;
        const paid = await this.chain.claimFor({
          refs: record.chainRefs,
          winner: winnerSide,
          bettor,
        });
        if (paid) console.log(`  paid @${bet.handle} $${paid.paidUsd.toFixed(2)}`);
      } catch (err) {
        console.error(
          `  PAYOUT FAILED for @${bet.handle} on market ${record.id}: ${(err as Error).message.slice(0, 160)}`,
        );
      }
    }
    await this.x.postReply({
      // A forfeited side's thread may be gone — the card is ours, always safe.
      inReplyTo: forfeit ? (record.cardTweetId ?? record.tweetBId) : record.tweetBId,
      text: forfeit
        ? forfeitRecap({
            winnerHandle: winner === "a" ? record.authorAHandle : record.authorBHandle,
            loserHandle: winner === "a" ? record.authorBHandle : record.authorAHandle,
          })
        : recap({
            winner,
            likesA,
            likesB,
            moneyImpliedAPct: Math.round(odds.impliedA * 100),
            tie: likesA === likesB,
            sideAHandle: record.authorAHandle,
            sideBHandle: record.authorBHandle,
          }),
    });
  }
}
