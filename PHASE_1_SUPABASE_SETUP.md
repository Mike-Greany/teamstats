# Phase 1 — Supabase setup

You'll create a free Supabase account, spin up one project, and apply the database schema.

Estimated time: 10–15 minutes.

---

## 1. Create a Supabase account

1. Go to **https://supabase.com** in Chrome.
2. Click **Start your project** (top right).
3. Sign in with **Google** (use the same Google account you use for the Apps Script app — `sharongreany@gmail.com` — or a separate one if you'd rather keep it isolated; doesn't matter for now).

## 2. Create a new project

1. After signing in you'll land on the dashboard. Click **New project**.
2. Fill in:
   - **Organization**: leave the default (auto-created from your email)
   - **Name**: `teamstats`
   - **Database password**: click **Generate a password** → **save it somewhere safe** (Supabase won't show it again, and you'll need it if you ever want to connect with a SQL client). Password manager works great.
   - **Region**: pick the one closest to you. **East US (N. Virginia)** is good for the East Coast.
   - **Pricing plan**: **Free**.
3. Click **Create new project**. It takes ~2 minutes to provision.

## 3. Apply the database schema

1. While the project finishes provisioning, open this file:
   `C:\Users\mgrea\OneDrive\Desktop\Spreadsheet for stats\teamstats\supabase\migrations\0001_init.sql`
   in Notepad → **Ctrl-A → Ctrl-C**.
2. In Supabase, click the **SQL Editor** icon in the left sidebar (looks like a `>_` terminal).
3. Click **+ New query** at the top.
4. Paste the SQL (Ctrl-V) into the big editor pane.
5. Click the green **Run** button (bottom-right of the editor) or press Ctrl-Enter.
6. You should see "Success. No rows returned." after a few seconds.

If you see a red error, copy the message and paste it back to me — I'll fix the SQL.

## 4. Create the logo storage bucket

1. In the Supabase sidebar, click **Storage**.
2. Click **New bucket**.
3. Name it **`logos`** (lowercase).
4. Toggle **Public bucket** ON (logos aren't sensitive; this lets the app embed them via URL without auth tokens).
5. Click **Create**.

## 5. Grab the API credentials

1. In the Supabase sidebar, click the gear icon **Project Settings** (bottom left).
2. Click **API** in the inner sidebar.
3. You'll see two values we need:
   - **Project URL**: looks like `https://abcdefghijk.supabase.co`
   - **anon public** key: long string starting with `eyJ...`

Paste **both** values back to me. They're not secret in the security sense — the anon key is meant for client-side use; security is enforced by Row-Level Security policies you just installed. But don't paste them into a public GitHub repo.

## 6. Quick smoke test (optional, but a nice confidence check)

In the SQL Editor, run:

```sql
select table_name from information_schema.tables where table_schema = 'public';
```

You should see: `teams`, `team_members`, `players`, `games`, `game_log`, `lineups`. Six tables.

Then:

```sql
select policyname, tablename from pg_policies where schemaname='public' order by tablename;
```

You should see ~24 RLS policies across the 6 tables. If both checks pass, Phase 1 is complete.

---

When you've pasted the **Project URL** and **anon key** back to me, I'll move on to Phase 2 (Cloudflare Pages + GitHub repo + frontend skeleton).
