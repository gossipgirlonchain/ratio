-- 0002: one wallet per person PER CHAIN.
--
-- NOT APPLIED. Needs winny's sign-off before it runs (schema changes are
-- explicitly a stop-and-ask).
--
-- Why: ratio now has a Solana wallet and an EVM wallet for the same person.
-- The existing table treats `x_user_id` as unique, which was right when there
-- was one chain and is wrong now — the EVM provider would either collide with
-- someone's Solana row or silently overwrite its address, and an overwritten
-- address is an unspendable balance.
--
-- Deliberately additive. Existing rows are Solana and are backfilled as such;
-- nothing is moved, rewritten or deleted. The Solana wallets keep working
-- exactly as they do today, which is the point — we namespace rather than
-- migrate, because migration is where the collide-two-users-into-one-wallet
-- bug lives and those wallets hold devnet funds and nothing of value.

alter table wallets add column if not exists chain text not null default 'solana';

alter table wallets add constraint wallets_chain_check
  check (chain in ('solana', 'ethereum'));

-- The uniqueness that actually holds now. Drop the old single-column
-- constraint only after the composite one exists, so there is no window in
-- which duplicates can be inserted.
create unique index if not exists wallets_user_chain_idx
  on wallets (x_user_id, chain);

alter table wallets drop constraint if exists wallets_pkey cascade;
alter table wallets add primary key (x_user_id, chain);

-- Address lookups happen on every signature (address -> privy_wallet_id), and
-- an address is globally unique regardless of chain.
create unique index if not exists wallets_address_idx on wallets (address);
