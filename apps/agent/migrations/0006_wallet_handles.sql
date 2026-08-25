-- Display cache: handle alongside the durable numeric X id.
alter table wallets add column if not exists handle text;
