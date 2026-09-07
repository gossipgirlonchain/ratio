/**
 * A one-at-a-time queue for transactions from a single EVM account.
 *
 * EVM accounts have nonces; Solana has blockhashes. So a code shape that is
 * perfectly safe on Solana — firing several sends from one account
 * concurrently, e.g. the engine provisioning three fee-recipient wallets in a
 * Promise.all — collides on EVM. Each send reads the same pending nonce and
 * all but one is rejected with "replacement transaction underpriced".
 *
 * Rather than track nonces ourselves (which then has to be reconciled after
 * every failure, restart and reorg) we serialise: one in flight per account,
 * so the node's own nonce is always current by the time the next one asks.
 *
 * Sends from DIFFERENT accounts stay parallel, since they have separate nonces
 * and are the common case for bettors.
 */
export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>();

  /** Run `fn` after everything already queued for `key` has settled. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = key.toLowerCase();
    const prev = this.tails.get(k) ?? Promise.resolve();
    // Swallow the predecessor's rejection: one failed send must not poison
    // every later send from the same account.
    const next = prev.then(fn, fn);
    this.tails.set(
      k,
      next.catch(() => undefined),
    );
    return next;
  }
}
