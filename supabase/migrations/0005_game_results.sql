-- Game results: W/L/T outcome + our score / their score, editable by coaches.
alter table games
  add column if not exists result      text check (result in ('W','L','T','')) default '',
  add column if not exists our_score   int,
  add column if not exists their_score int;
