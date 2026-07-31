/**
 * The ratio engine: mention -> pair resolution -> eligibility -> market ->
 * 24h settlement on absolute like counts.
 *
 * Flow rules (spec):
 *   - side B = the reply/QT, side A = the tweet it references; one code path
 *   - anyone can tag; no allowlist; rejected mentions get ONE reply, never retried
 *   - higher absolute like count at created_at + 24h wins; exact tie -> side A
 *   - voids: either tweet unreadable (deleted/suspended/private/blocked), or
 *     no money on the winning side (ZeroClaimableSupply guard, ported)
 *   - mid-window health check so voids surface before settlement
 *
 * Ported from cue-wire verbatim where the spec says to: mention idempotency,
 * late-stake rejection, min/max caps, the pre-migration odds snapshot, the
 * one-linked-post cost policy.
 */

import {
  betConfirm,
  hiddenNotice,
  marketCard,
  recap,
  rejection,
  voidNotice,
  type RejectionReason,
} from "@ratio/config/copy";

import type { FeeBeneficiary, MarketChain } from "./chain.js";
import { parseMention, substantiveText } from "./parse.js";
import type { MarketRecord, PairType, Store } from "./store.js";
import type { WalletProvider } from "./wallets.js";
import type { XClient, XMention, XTweet } from "./x.js";

export interface EngineConfig {
  botHandle: string;
  freshnessWindowMs: number; // side B under this old at mention time
  marketDurationMs: number; // 24h
  healthCheckAtFraction: number; // 0.5 = midpoint
  minStakeUsd: number;
  maxStakeUsd: number;
  /** Independent reporters required before the hidden badge goes live. */
  hiddenReportThreshold: number;
  protocolWallet: string;
  /** Five-party split of the swap fee; values pend Doppler answers (R3). */
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
    const intent = parseMention(mention.text);
    if (intent.action === "ignore") return; // read cost only, never reply to noise

    if (intent.action === "bet") {
      if (!mention.target) return;
      const record = await this.store.getMarketByTweet(mention.target.tweetId);
      if (!record || record.status !== "open") return;
      if (this.config.now() >= record.settlesAtMs) {
        console.log(`  (stake from @${mention.authorHandle} too late — market closed)`);
        return; // skip silently: no reply spend on late stakes
      }
      await this.placeBet(mention, record, intent.side, intent.amountUsd);
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
      await this.x.postReply({
        inReplyTo: mention.mentionTweetId,
        text: rejection(reason, this.config.botHandle),
      });
    };

    if (typeof pair === "string") return reject(pair);
    const { sideA, sideB, pairType } = pair;

    // Eligibility gate — all required.
    if (sideA.authorId === sideB.authorId) return reject("same_author");
    const age = now - sideB.createdAtMs;
    if (age >= this.config.freshnessWindowMs) return reject("too_old");
    if (await this.store.getMarketByPair(sideA.tweetId, sideB.tweetId))
      return reject("already_exists");

    // Every fee recipient gets a wallet at creation, used-the-product or not
    // (unclaimed balances are the acquisition hook — R4 wires notifications).
    const [tagger, walletA, walletB] = await Promise.all([
      this.wallets.getWallet(mention.authorId),
      this.wallets.getWallet(sideA.authorId),
      this.wallets.getWallet(sideB.authorId),
    ]);
    const share = this.config.feeShareBps;
    const feeBeneficiaries: FeeBeneficiary[] = [
      { wallet: this.config.dopplerWallet, shareBps: share.doppler },
      { wallet: tagger.address, shareBps: share.tagger },
      { wallet: walletA.address, shareBps: share.sideA },
      { wallet: walletB.address, shareBps: share.sideB },
      { wallet: this.config.protocolWallet, shareBps: share.protocol },
    ];

    const chainRefs = await this.chain.createMarket({
      nonce: sideB.tweetId,
      feeBeneficiaries,
      outcomes: [`A @${sideA.authorHandle}`, `B @${sideB.authorHandle}`],
    });

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
    };
    await this.store.saveMarket(record);

    // The ONE linked post per market — the market card, in side B's thread.
    const card = await this.x.postReply({
      inReplyTo: sideB.tweetId,
      text: marketCard({
        settlesAtMs: record.settlesAtMs,
        sideAHandle: sideA.authorHandle,
        sideBHandle: sideB.authorHandle,
      }),
      link: this.config.marketUrl(record.id),
    });
    await this.store.updateMarket(record.id, { cardTweetId: card.tweetId });
  }

  private async placeBet(
    mention: XMention,
    record: MarketRecord,
    side: 0 | 1,
    amountUsd: number,
  ): Promise<void> {
    const { config } = this;
    if (amountUsd < config.minStakeUsd) return; // below min: no reply spend
    const capped = Math.min(amountUsd, config.maxStakeUsd);

    const bettor = await this.wallets.getWallet(mention.authorId);
    const result = await this.chain.placeBet({
      refs: record.chainRefs,
      side,
      amountUsd: capped,
      bettor: bettor.address,
    });
    await this.store.saveBet({
      marketId: record.id,
      xUserId: mention.authorId,
      handle: mention.authorHandle,
      side,
      amountUsd: capped,
      tokensOut: result.tokensOut,
      placedAtMs: config.now(),
    });

    const odds = await this.chain.getOdds(record.chainRefs);
    await this.x.postReply({
      inReplyTo: mention.mentionTweetId,
      text: betConfirm({
        handle: mention.authorHandle,
        amountUsd: capped,
        side,
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

  /** Mid-window health check: surface voids before settlement, not at it. */
  async healthCheckDueMarkets(): Promise<void> {
    const now = this.config.now();
    const due = await this.store.listOpenMarketsNeedingHealthCheck(
      (m) =>
        m.createdAtMs +
        (m.settlesAtMs - m.createdAtMs) * this.config.healthCheckAtFraction,
      now,
    );
    for (const record of due) {
      try {
        const [a, b] = await Promise.all([
          this.x.getTweet(record.tweetAId),
          this.x.getTweet(record.tweetBId),
        ]);
        // Mark checked only after a successful read: a transient API failure
        // leaves the flag unset so the next tick retries the check.
        await this.store.updateMarket(record.id, { healthCheckedAtMs: now });
        if (!a || !b)
          await this.voidMarket(record, "a side went unreadable mid market");
      } catch (err) {
        console.error(
          `  health check ${record.id} deferred:`,
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
    if (!a || !b) {
      return this.voidMarket(record, "a side went unreadable before settlement");
    }

    // Absolute counts, no age normalisation. Exact tie: side A held the line.
    const winner: "a" | "b" = b.likeCount > a.likeCount ? "b" : "a";
    const winnerSide: 0 | 1 = winner === "a" ? 0 : 1;

    // Snapshot BEFORE settle: vaults drain at migration, and the recap is
    // the distribution loop — without this it has nothing to say.
    const odds = await this.chain.getOdds(record.chainRefs);
    const snapshot = {
      likesAFinal: a.likeCount,
      likesBFinal: b.likeCount,
      finalImpliedA: odds.impliedA,
      finalPotUsd: odds.raisedUsd[0] + odds.raisedUsd[1],
    };

    // Ported ZeroClaimableSupply guard: nobody holds the winning side ->
    // on-chain migration throws. Void; bettors exit on the open curve.
    if (odds.raisedUsd[winnerSide] === 0) {
      await this.store.updateMarket(record.id, snapshot);
      return this.voidMarket(record, "the winning side had no money on it");
    }

    await this.chain.settle({ refs: record.chainRefs, winner: winnerSide });
    await this.store.updateMarket(record.id, {
      status: "settled",
      winner,
      ...snapshot,
    });
    await this.x.postReply({
      inReplyTo: record.tweetBId,
      text: recap({
        winner,
        likesA: a.likeCount,
        likesB: b.likeCount,
        moneyImpliedAPct: Math.round(odds.impliedA * 100),
        tie: a.likeCount === b.likeCount,
      }),
    });
  }

  private async voidMarket(record: MarketRecord, reason: string): Promise<void> {
    await this.chain.void(record.chainRefs);
    await this.store.updateMarket(record.id, {
      status: "voided",
      voidReason: reason,
    });
    // Side B may be the tweet that vanished — the card is ours, always safe.
    await this.x.postReply({
      inReplyTo: record.cardTweetId ?? record.tweetBId,
      text: voidNotice(reason),
    });
  }
}
