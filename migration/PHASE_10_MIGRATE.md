# Phase 10 — Migrate Teddy 10U into TeamStats

This walks you through pulling your existing Teddy team's data (roster, schedule, game-log,
profiles, lineups) out of the Apps Script Google Sheet and into TeamStats.

Estimated time: 5 minutes once you've got the inputs ready.

The migration is **idempotent** — safe to re-run if anything goes sideways. Existing
roster/schedule rows are reused; game-log and lineups upsert.

---

## 1. Create the Teddy team in the app

1. Open https://teamstats.mgreany.workers.dev/ on your laptop, signed in.
2. Tap **+ Create another team** (from the team picker, or land directly via `#/new`).
3. Fill in:
   - **Team name**: `Teddy 10U 2026`
   - **URL slug**: `teddy-10u-2026` (you'll need this exact value for the script)
   - **Season**: `2026 Spring`
   - **Primary color**: `#1f3864`
   - **Accent color**: `#c9a227`
4. Tap **Create team**. You'll land on the (empty) team home.

Don't add the roster or schedule manually — the script will do that.

## 2. Grab your Supabase service_role key

This key is the **secret** one, only used by this one-time script. **Never paste it into the app, GitHub, or a public place.**

1. Supabase → ⚙ Project Settings → **API**
2. Copy the value of **`secret_key`** (starts with `sb_secret_...`).

## 3. Run the migration script

Open PowerShell and run (substitute your secret key for `<SECRET>`):

```powershell
cd "C:\Users\mgrea\OneDrive\Desktop\Spreadsheet for stats\teamstats\migration"
py migrate_teddy.py teddy-10u-2026 <SECRET>
```

You'll see output like:

```
→ Looking up team "teddy-10u-2026"...
  ✓ Teddy 10U 2026 (abc-uuid)

→ Opening C:\Users\mgrea\...\Teddy's 10U 2026.xlsx...
  ✓ Sheets: ['Team Batting', 'Game Log', 'Player Profiles', 'Lineups', 'Schedule', ...]

→ Inserting roster...
  ✓ Inserted 13 players

→ Inserting schedule...
  ✓ Inserted 12 games

→ Inserting game log...
  ✓ Upserted 52 game-log rows

→ Updating player profiles...
  ✓ Updated 4 player profiles

→ Inserting lineups...
  ✓ Upserted 3 lineups

✅ Migration complete. Open https://teamstats.mgreany.workers.dev/#/t/teddy-10u-2026
```

If you see warnings like `Skip: ... not found`, those rows referenced a player or date
that doesn't exist in the new system — usually safe to ignore (likely typos or stale
references). The script keeps going.

## 4. Verify in the app

1. Open https://teamstats.mgreany.workers.dev/#/t/teddy-10u-2026 on your Pixel.
2. **Team Batting** — should match what your old app showed (within a row or two if you
   were mid-game when you migrated).
3. **Schedule** — 12 games listed.
4. **Players** — all 13 girls listed.
5. **Log** — all 52 entries.
6. Tap any player → profile renders correctly; profile info populated if you'd filled it in.
7. **Lineup** → pick a game → if you'd saved a lineup before, it's there.

## 5. Re-running

If something looks off, edit the data in the old app (or the new app), then re-run the
script — it's safe. Roster/schedule inserts are skipped if the rows already exist;
game-log and lineups upsert on conflict so you always get the latest values.

## 6. Ship to first coach friend

You can keep using the Apps Script app for the rest of this season — the new TeamStats
app is your testing playground. When you're ready, send a friend the parent-view URL:

```
https://teamstats.mgreany.workers.dev/#/t/teddy-10u-2026
```

They'll see your team page with all the data, no sign-in needed.

For their own team, share:

```
https://teamstats.mgreany.workers.dev/
```

They sign in with their email → create their team → import their roster + schedule.
