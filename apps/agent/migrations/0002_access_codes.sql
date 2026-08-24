-- applied 2026-08-24 (closed beta wall)
create table access_codes (
  code text primary key,
  created_at_ms bigint not null,
  note text,
  redeemed_at_ms bigint,
  redeemed_by text
);
alter table access_codes enable row level security;
