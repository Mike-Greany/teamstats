-- Optional URL for the league logo (right side of the top bar).
-- When set, the logo becomes a clickable link to this page.
alter table teams
  add column if not exists league_url text;
