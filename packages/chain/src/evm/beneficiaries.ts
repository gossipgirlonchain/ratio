/**
 * Turning ratio's five-way fee split into what Doppler's initializer will
 * actually accept.
 *
 * Our split is expressed in bps of the swap fee: doppler 750 / protocol 4500 /
 * sideA 1800 / sideB 1800 / tagger 1150. Doppler wants something stricter
 * (src/types/BeneficiaryData.sol, `_storeBeneficiaries`):
 *
 *   - addresses STRICTLY ascending, so duplicates are impossible
 *   - every share > 0
 *   - shares in WAD, summing to exactly 1e18
 *   - the airlock owner present, holding at least MIN_PROTOCOL_OWNER_SHARES (5%)
 *
 * Three of those bite:
 *
 * Duplicates are legitimate in ratio — the tagger is allowed to be side B's
 * author, and that stacks two slices onto one wallet. The Solana initializer
 * rejected duplicates too, and we merged there for the same reason. So "five
 * beneficiaries" is up to five; four is correct and normal.
 *
 * The airlock owner has no analogue on Solana. Doppler's protocol slice has to
 * be paid to that exact address rather than a wallet of our choosing, so on EVM
 * `dopplerWallet` IS the airlock owner. Our 7.5% clears the 5% floor with room,
 * so the economics are unchanged — this only constrains which address fills the
 * slot.
 *
 * Sorting is by address as a NUMBER, not as a string.
 */

export interface FeeBeneficiary {
  wallet: string;
  shareBps: number;
}

export interface DopplerBeneficiary {
  beneficiary: `0x${string}`;
  shares: bigint;
}

/** 1e18. Doppler denominates shares in WAD. */
export const WAD = 1_000_000_000_000_000_000n;

/** MIN_PROTOCOL_OWNER_SHARES: WAD / 20. */
export const MIN_PROTOCOL_OWNER_SHARES = WAD / 20n;

/** 10_000 bps == 1 WAD, so one bp is exactly 1e14 — no rounding drift. */
const WAD_PER_BP = WAD / 10_000n;

export class BeneficiaryError extends Error {}

/**
 * @param parties our split, duplicates allowed
 * @param airlockOwner the address Doppler requires as protocol-owner beneficiary
 */
export function buildBeneficiaries(
  parties: FeeBeneficiary[],
  airlockOwner: string,
): DopplerBeneficiary[] {
  if (parties.length === 0) throw new BeneficiaryError("no fee beneficiaries given");

  // Merge by wallet. Lowercase is the identity: the same address in different
  // checksum casing is the same payee, and letting both through would trip
  // Doppler's strictly-ascending check in a way that is maddening to debug.
  const merged = new Map<string, number>();
  for (const p of parties) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(p.wallet)) {
      throw new BeneficiaryError(`not an address: ${p.wallet}`);
    }
    if (!Number.isInteger(p.shareBps) || p.shareBps <= 0) {
      throw new BeneficiaryError(`shareBps must be a positive integer, got ${p.shareBps}`);
    }
    const key = p.wallet.toLowerCase();
    merged.set(key, (merged.get(key) ?? 0) + p.shareBps);
  }

  const totalBps = [...merged.values()].reduce((a, b) => a + b, 0);
  if (totalBps !== 10_000) {
    throw new BeneficiaryError(`shareBps must sum to 10000, got ${totalBps}`);
  }

  const owner = airlockOwner.toLowerCase();
  const ownerBps = merged.get(owner);
  if (ownerBps === undefined) {
    throw new BeneficiaryError(
      `airlock owner ${airlockOwner} must be a beneficiary — on EVM the Doppler slice pays to it`,
    );
  }
  if (BigInt(ownerBps) * WAD_PER_BP < MIN_PROTOCOL_OWNER_SHARES) {
    throw new BeneficiaryError(
      `airlock owner needs at least 500 bps (5%), has ${ownerBps}`,
    );
  }

  const out = [...merged.entries()]
    .map(([wallet, bps]) => ({
      beneficiary: wallet as `0x${string}`,
      shares: BigInt(bps) * WAD_PER_BP,
    }))
    // ascending by NUMERIC address; BigInt compare, never string compare
    .sort((a, b) => (BigInt(a.beneficiary) < BigInt(b.beneficiary) ? -1 : 1));

  const totalShares = out.reduce((sum, b) => sum + b.shares, 0n);
  if (totalShares !== WAD) {
    throw new BeneficiaryError(`shares must sum to 1e18, got ${totalShares}`);
  }
  return out;
}
