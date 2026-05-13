-- Allow users with an invite link to self-add as parent OR coach (not owner).
-- The trigger that auto-makes the team creator an owner is SECURITY DEFINER so
-- it isn't affected by this policy change.

drop policy if exists team_members_insert on team_members;

create policy team_members_insert on team_members for insert
  with check (
    (user_id = auth.uid() and role in ('parent','coach'))
    or is_team_owner(team_id)
  );
