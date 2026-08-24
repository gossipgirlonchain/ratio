-- applied 2026-08-24 (Privy server wallets, R4)
create table wallets (
  x_user_id text primary key,
  privy_wallet_id text not null,
  address text not null unique,
  created_at_ms bigint not null
);
alter table wallets enable row level security;
