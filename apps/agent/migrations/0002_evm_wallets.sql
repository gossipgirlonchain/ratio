-- 0002: one wallet per person PER CHAIN.
--
-- APPLIED 2026-09-07 to project izerzbfgjsuluofllstc. 9 rows, all backfilled
-- as 'solana'. Verified afterwards: primary key (x_user_id, chain), address
-- still globally unique, zero rows changed.
--
-- Why: ratio now has a Solana wallet and an EVM wallet for the same person.
-- The old table treated x_user_id as unique, which was right when there was
-- one chain and is wrong now — the EVM provider would either collide with
-- someone's Solana row or overwrite its address, and an overwritten address is
-- an unspendable balance.
--
-- Deliberately additive. Nothing is moved, rewritten or deleted; the Solana
-- wallets keep working exactly as before. We namespace rather than migrate,
-- because migration is where the collide-two-users-into-one-wallet bug lives.
--
-- Checked before running: zero inbound foreign keys reference wallets, so
-- replacing the primary key could not cascade into another table.

alter table wallets add column if not exists chain text not null default 'solana';

alter table wallets drop constraint if exists wallets_chain_check;
alter table wallets add constraint wallets_chain_check
  check (chain in ('solana', 'ethereum'));

-- The composite key creates its own unique index, so no separate one is
-- needed, and the pre-existing wallets_address_key already covers address
-- globally — an address belongs to exactly one wallet on exactly one chain.
alter table wallets drop constraint wallets_pkey;
alter table wallets add primary key (x_user_id, chain);
