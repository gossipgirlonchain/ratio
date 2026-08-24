-- ratio store, migration 0001. Mirrors apps/agent/src/store.ts shapes
-- exactly; the SupabaseStore adapter maps snake_case <-> camelCase.
-- Times are epoch ms bigints (the whole codebase speaks ms).

create table markets (
  id text primary key,                       -- = tweet_b_id
  tweet_a_id text not null,
  tweet_b_id text not null,
  author_a_x_id text not null,
  author_b_x_id text not null,
  tagger_x_id text not null,
  pair_type text not null check (pair_type in ('quote', 'reply')),
  b_selected_by text not null check (b_selected_by in ('tagger', 'auto')),
  created_at_ms bigint not null,
  settles_at_ms bigint not null,
  tweet_b_age_at_create_ms bigint not null,
  likes_a_at_create integer not null,
  likes_b_at_create integer not null,
  -- no 'voided': settled or forfeited, always (voids deleted 2026-08-11)
  status text not null check (status in ('open', 'settled', 'forfeited')),
  winner text check (winner in ('a', 'b')),
  likes_a_final integer,
  likes_b_final integer,
  final_implied_a double precision,
  final_pot_usd numeric,
  last_likes_sample_at_ms bigint,
  hidden_reporter_ids jsonb not null default '[]',
  hidden_report_count integer not null default 0,
  hidden_reported_at_ms bigint,
  card_tweet_id text,
  chain_refs jsonb not null,
  doppler_pool_id text,
  author_a_handle text not null,
  author_b_handle text not null,
  tagger_handle text not null
);

-- tweet_a_id is a PRIMARY read path (post views) — indexed, HARD rule.
create index markets_tweet_a_idx on markets (tweet_a_id);
create index markets_tweet_b_idx on markets (tweet_b_id);
create index markets_status_settles_idx on markets (status, settles_at_ms);
create index markets_card_tweet_idx on markets (card_tweet_id);

create table bets (
  id bigint generated always as identity primary key,
  market_id text not null references markets (id),
  x_user_id text not null,
  handle text not null,
  side smallint not null check (side in (0, 1)),
  direction text not null check (direction in ('buy', 'sell')),
  amount_usd numeric not null,
  tokens_out numeric not null,
  placed_at_ms bigint not null,
  is_seed boolean not null default false
);

create index bets_market_idx on bets (market_id);
create index bets_user_idx on bets (x_user_id);
create index bets_placed_idx on bets (placed_at_ms);

create table like_samples (
  id bigint generated always as identity primary key,
  market_id text not null references markets (id),
  at_ms bigint not null,
  likes_a integer not null,
  likes_b integer not null
);

create index like_samples_market_idx on like_samples (market_id, at_ms);

-- mention idempotency: the X mention poll re-shows mentions; double
-- processing double-spends. Insert-once semantics via primary key.
create table mentions_processed (
  mention_tweet_id text primary key,
  processed_at_ms bigint not null
);

-- RLS: the world may READ (profiles are permissionless, unclaimed
-- balances are public record); only the service role writes. The agent
-- uses the service key which bypasses RLS entirely.
alter table markets enable row level security;
alter table bets enable row level security;
alter table like_samples enable row level security;
alter table mentions_processed enable row level security;

create policy markets_public_read on markets for select using (true);
create policy bets_public_read on bets for select using (true);
create policy like_samples_public_read on like_samples for select using (true);
-- mentions_processed: no public policies at all — service role only.
