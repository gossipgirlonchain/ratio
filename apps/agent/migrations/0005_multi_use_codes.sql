-- Multi-use access codes: max_uses per code (default 1 = old behavior),
-- use_count tracks burns, redeem_access_code() burns atomically.
alter table access_codes
  add column if not exists max_uses integer not null default 1,
  add column if not exists use_count integer not null default 0;
update access_codes set use_count = 1 where redeemed_at_ms is not null and use_count = 0;

create or replace function redeem_access_code(p_code text, p_by text)
returns boolean
language sql
security definer
as $$
  update access_codes
  set use_count = use_count + 1,
      redeemed_at_ms = (extract(epoch from now()) * 1000)::bigint,
      redeemed_by = p_by
  where code = p_code and use_count < max_uses
  returning true;
$$;
