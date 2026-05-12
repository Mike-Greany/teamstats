-- Add strikeout columns to game_log and a per-team column-visibility list.
-- Apply by pasting into the Supabase SQL Editor and clicking Run.

alter table game_log
  add column if not exists k          int default 0,  -- swinging strikeout
  add column if not exists k_looking  int default 0;  -- called strikeout (the backwards-K)

alter table teams
  add column if not exists hidden_stat_cols text[] default '{k,k_looking}';
  -- Defaults to hiding strikeouts from the public parent view; coach can change.
