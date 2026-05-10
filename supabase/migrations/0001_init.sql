-- ============================================================
-- TeamStats — multi-tenant softball/baseball stats schema
-- Apply by pasting into Supabase SQL Editor (one project) and clicking Run.
-- ============================================================

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists teams (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  season          text,
  primary_color   text default '#1f3864',
  accent_color    text default '#c9a227',
  logo_url        text,
  league_logo_url text,
  is_public       boolean default true,        -- false = members only (parents need an account)
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz default now()
);

create table if not exists team_members (
  team_id  uuid references teams(id) on delete cascade,
  user_id  uuid references auth.users(id) on delete cascade,
  role     text not null check (role in ('owner','coach','parent')),
  created_at timestamptz default now(),
  primary key (team_id, user_id)
);

create table if not exists players (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  first_name     text not null,
  last_name      text not null default '',
  jersey         text,
  position       text,
  bats           text default '' check (bats in ('L','R','S','')),
  throws         text default '' check (throws in ('L','R','')),
  height         text,
  age            text,
  dob            text,                          -- "M/D" string, parents fill freely
  favorite_color text,
  bio            text,
  photo_url      text,
  display_order  int default 0,
  created_at     timestamptz default now()
);

create index if not exists players_team_idx on players(team_id);

create table if not exists games (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  date       date not null,
  opponent   text,
  home_away  text default 'home' check (home_away in ('home','away')),
  location   text,
  game_time  time,
  notes      text,
  created_at timestamptz default now()
);

create index if not exists games_team_date_idx on games(team_id, date);

create table if not exists game_log (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  ab  int default 0,
  r   int default 0,
  h   int default 0,
  b1  int default 0,
  b2  int default 0,
  b3  int default 0,
  hr  int default 0,
  bb  int default 0,
  hbp int default 0,
  rbi int default 0,
  sb  int default 0,
  notes text,
  created_at timestamptz default now(),
  unique (game_id, player_id)
);

create index if not exists game_log_team_idx on game_log(team_id);
create index if not exists game_log_player_idx on game_log(player_id);

create table if not exists lineups (
  game_id        uuid primary key references games(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  batting_order  jsonb default '[]'::jsonb,    -- ordered array of player_id (uuid)
  positions      jsonb default '{}'::jsonb,    -- { player_id: ["SS","3B",...] }  array length = innings
  notes          text,
  updated_at     timestamptz default now(),
  updated_by     uuid references auth.users(id) on delete set null
);

create index if not exists lineups_team_idx on lineups(team_id);

-- ============================================================
-- ROW-LEVEL SECURITY (multi-tenancy guarantee)
-- Without these, every row is visible to everyone with the anon key.
-- ============================================================

alter table teams         enable row level security;
alter table team_members  enable row level security;
alter table players       enable row level security;
alter table games         enable row level security;
alter table game_log      enable row level security;
alter table lineups       enable row level security;

-- Helper: is this auth.uid() a member of this team_id with a writer role?
create or replace function is_team_writer(_team_id uuid)
returns boolean
language sql security definer
as $$
  select exists (
    select 1 from team_members
    where team_id = _team_id
      and user_id = auth.uid()
      and role in ('owner','coach')
  );
$$;

create or replace function is_team_owner(_team_id uuid)
returns boolean
language sql security definer
as $$
  select exists (
    select 1 from team_members
    where team_id = _team_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function is_team_member(_team_id uuid)
returns boolean
language sql security definer
as $$
  select exists (
    select 1 from team_members
    where team_id = _team_id
      and user_id = auth.uid()
  );
$$;

-- ---------- teams ----------
-- Public teams visible to everyone; private only to members.
create policy teams_select on teams for select
  using (is_public = true or is_team_member(id));
-- Anyone authenticated can create a team (themselves as owner via trigger below).
create policy teams_insert on teams for insert
  with check (auth.uid() is not null);
create policy teams_update on teams for update
  using (is_team_owner(id))
  with check (is_team_owner(id));
create policy teams_delete on teams for delete
  using (is_team_owner(id));

-- ---------- team_members ----------
create policy team_members_select on team_members for select
  using (is_team_member(team_id) or user_id = auth.uid());
create policy team_members_insert on team_members for insert
  with check (
    -- creator-of-team can insert themselves as owner via trigger,
    -- otherwise only existing owners can add new members.
    user_id = auth.uid() or is_team_owner(team_id)
  );
create policy team_members_delete on team_members for delete
  using (is_team_owner(team_id) and user_id <> auth.uid());

-- ---------- players ----------
create policy players_select on players for select
  using (
    exists (select 1 from teams t where t.id = players.team_id and (t.is_public or is_team_member(t.id)))
  );
create policy players_insert on players for insert with check (is_team_writer(team_id));
create policy players_update on players for update
  using (
    -- writers can update anything; anon/parents can update profile-only fields via a separate view (v2).
    is_team_writer(team_id)
  )
  with check (is_team_writer(team_id));
create policy players_delete on players for delete using (is_team_writer(team_id));

-- ---------- games ----------
create policy games_select on games for select
  using (
    exists (select 1 from teams t where t.id = games.team_id and (t.is_public or is_team_member(t.id)))
  );
create policy games_insert on games for insert with check (is_team_writer(team_id));
create policy games_update on games for update using (is_team_writer(team_id)) with check (is_team_writer(team_id));
create policy games_delete on games for delete using (is_team_writer(team_id));

-- ---------- game_log ----------
create policy game_log_select on game_log for select
  using (
    exists (select 1 from teams t where t.id = game_log.team_id and (t.is_public or is_team_member(t.id)))
  );
create policy game_log_insert on game_log for insert with check (is_team_writer(team_id));
create policy game_log_update on game_log for update using (is_team_writer(team_id)) with check (is_team_writer(team_id));
create policy game_log_delete on game_log for delete using (is_team_writer(team_id));

-- ---------- lineups ----------
create policy lineups_select on lineups for select
  using (
    exists (select 1 from teams t where t.id = lineups.team_id and (t.is_public or is_team_member(t.id)))
  );
create policy lineups_insert on lineups for insert with check (is_team_writer(team_id));
create policy lineups_update on lineups for update using (is_team_writer(team_id)) with check (is_team_writer(team_id));
create policy lineups_delete on lineups for delete using (is_team_writer(team_id));

-- ============================================================
-- TRIGGER: auto-grant ownership when a user creates a team
-- ============================================================
create or replace function add_team_creator_as_owner()
returns trigger
language plpgsql security definer
as $$
begin
  if new.created_by is not null then
    insert into team_members (team_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_team_owner on teams;
create trigger trg_team_owner
after insert on teams
for each row execute function add_team_creator_as_owner();

-- ============================================================
-- STORAGE: per-team logo bucket
-- Run this AFTER you create a "logos" bucket via the Supabase UI
-- (Storage → New bucket → name "logos" → Public).
-- ============================================================
-- Public bucket for now (logos are not sensitive).
-- Per-team folder structure: logos/<team_id>/<filename>.
-- For private buckets in v2, add policies that check is_team_member(team_id from path).
