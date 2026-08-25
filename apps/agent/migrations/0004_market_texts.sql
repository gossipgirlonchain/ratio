-- Tweet text display cache: the strip needs both texts and the store is
-- the only place that can remember them (X reads cost money).
alter table markets add column if not exists text_a text, add column if not exists text_b text;
