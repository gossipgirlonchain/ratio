/**
 * The reply score. Out of 5000, from 7 days of replies/QTs, and none of
 * the inputs need like counts (keeps the data source cheap — see types.ts).
 */

import {
  PERCENTILE_BANDS,
  ROOMS_SATURATION_FOLLOWERS,
  SCORE_MAX,
  SEED_DISTRIBUTION_N,
  SPEED_SATURATION_S,
  VOLUME_SATURATION,
  W_ROOMS,
  W_SPEED,
  W_VOLUME,
  tierFor,
} from "./config";
import { UserReply } from "./types";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface ScoreBreakdown {
  score: number;
  tier: string;
  volume: number; // replies in window
  medianReplyS: number;
  medianRoomFollowers: number;
  /** funniest line on the card: who they replied to most, and how often */
  mostRepliedTo: { handle: string; count: number } | null;
  /** biggest-follower account replied to + that tweet's reply count */
  biggestRoom: { handle: string; replyCount: number } | null;
}

export function computeScore(replies: UserReply[]): ScoreBreakdown {
  const volume = replies.length;
  const delaysS = replies.map((r) => (r.createdAtMs - r.parent.createdAtMs) / 1000);
  const rooms = replies.map((r) => r.parent.author.followers);
  const medianReplyS = Math.round(median(delaysS));
  const medianRoomFollowers = Math.round(median(rooms));

  // volume: log-scaled, saturating
  const vComp = clamp01(Math.log1p(volume) / Math.log1p(VOLUME_SATURATION));
  // speed: full marks at/under saturation, hyperbolic falloff after —
  // 10x slower than the bar reads as one tenth
  const sComp = volume === 0 ? 0 : clamp01(SPEED_SATURATION_S / Math.max(medianReplyS, SPEED_SATURATION_S));
  // rooms: log-scaled follower count
  const rComp = clamp01(Math.log1p(medianRoomFollowers) / Math.log1p(ROOMS_SATURATION_FOLLOWERS));

  const score =
    volume === 0
      ? 0
      : Math.round((W_VOLUME * vComp + W_SPEED * sComp + W_ROOMS * rComp) * SCORE_MAX);

  const counts = new Map<string, number>();
  for (const r of replies)
    counts.set(r.parent.author.handle, (counts.get(r.parent.author.handle) ?? 0) + 1);
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  const biggest = [...replies].sort(
    (a, b) => b.parent.author.followers - a.parent.author.followers,
  )[0];

  return {
    score,
    tier: tierFor(score),
    volume,
    medianReplyS,
    medianRoomFollowers,
    mostRepliedTo: most ? { handle: most[0], count: most[1] } : null,
    biggestRoom: biggest
      ? { handle: biggest.parent.author.handle, replyCount: biggest.parent.replyCount }
      : null,
  };
}

// --- percentile ------------------------------------------------------------
/**
 * Reference distribution. MOCK: a seeded log-normal-ish sample stands in
 * for the precomputed seed list of a few thousand crypto Twitter accounts
 * (open question 4: who's in it decides what the percentile means).
 * Real impl: precompute scores for the seed list, store the sorted array.
 */
const seedDistribution: number[] = (() => {
  let a = 0x9e3779b9;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const xs: number[] = [];
  for (let i = 0; i < SEED_DISTRIBUTION_N; i++) {
    // sum of squares skews low: most accounts barely reply
    const u = (rand() ** 1.8 * 0.75 + rand() * 0.25) * 0.92;
    xs.push(Math.round(u * SCORE_MAX));
  }
  return xs.sort((x, y) => x - y);
})();

export interface Percentile {
  /** e.g. "top 4% of reply guys" or a band label below the top-50 cut */
  label: string;
  topPct: number; // 1 = top 1%
}

export function percentileFor(score: number): Percentile {
  let lo = 0,
    hi = seedDistribution.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seedDistribution[mid]! <= score) lo = mid + 1;
    else hi = mid;
  }
  const below = lo / seedDistribution.length;
  const topPct = Math.max(1, Math.round((1 - below) * 100));
  if (topPct <= 50) return { label: `top ${topPct}% of reply guys`, topPct };
  const band = PERCENTILE_BANDS.find((b) => topPct <= b.maxTopPct) ?? PERCENTILE_BANDS[PERCENTILE_BANDS.length - 1]!;
  return { label: band.label, topPct };
}
