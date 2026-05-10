# Phase 2 — GitHub repo + Cloudflare Pages

You'll create a GitHub account (if you don't have one), push the local `teamstats/` folder to a new repo, sign up for Cloudflare Pages, and connect the repo so every push auto-deploys.

Estimated time: 15–20 minutes.

End state: a live URL like `https://teamstats-xxx.pages.dev` that you can open on your Pixel and see the "TeamStats — Phase 2" hello card with `DB: connected (0 public teams)` and `Auth: not signed in`.

---

## 1. Sign in to GitHub

1. Go to **https://github.com**.
2. If you don't have an account, click **Sign up** (free); use any email.
3. If you do, click **Sign in**.

## 2. Create the repo

1. Top-right click the **+** icon → **New repository**.
2. Repository name: **`teamstats`**.
3. Description (optional): *Multi-team softball stats PWA*.
4. Set to **Public**. (Cloudflare Pages can pull from private repos too, but public is simpler. The Supabase keys are publishable — safe to expose.)
5. **Do NOT** check "Add a README", "Add .gitignore", or "Add a license" — we already have those locally.
6. Click **Create repository**.

GitHub shows a "quick setup" page with commands to push existing code. Keep that tab open.

## 3. Install Git for Windows (if not already installed)

Open PowerShell and type `git --version`. If you get a version number, skip to step 4.

If you get "command not found":
1. Download **https://git-scm.com/download/win** → run the installer.
2. Accept the defaults.
3. After install, open a NEW PowerShell window and run `git --version` to confirm.

## 4. Push the local folder to GitHub

Open PowerShell, then run these commands one at a time. **Replace `<YOUR-USERNAME>`** with your actual GitHub username in the last command.

```powershell
cd "C:\Users\mgrea\OneDrive\Desktop\Spreadsheet for stats\teamstats"
git init
git add .
git commit -m "Phase 2: Supabase connection + PWA shell"
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/teamstats.git
git push -u origin main
```

The `git push` command will prompt you to sign in to GitHub in a browser pop-up — sign in and authorize.

When it finishes, refresh the GitHub repo page in your browser — you should see all the files listed.

## 5. Sign up for Cloudflare

1. Go to **https://dash.cloudflare.com/sign-up**.
2. Sign up with email + password (or use Google).
3. After verifying email, you land on the Cloudflare dashboard.

## 6. Connect the GitHub repo to Cloudflare Pages

1. In the Cloudflare dashboard, left sidebar → **Workers & Pages**.
2. Click **Create** → **Pages** tab → **Connect to Git**.
3. **Connect GitHub** → authorize Cloudflare to read your repos. On the GitHub auth screen, you can grant access to "All repositories" or just `teamstats` — your choice.
4. Pick the **`teamstats`** repo from the list → **Begin setup**.
5. Configure build settings:
   - **Project name**: `teamstats` (this becomes the URL: `teamstats.pages.dev`)
   - **Production branch**: `main`
   - **Framework preset**: **None**
   - **Build command**: leave empty
   - **Build output directory**: `public`
   - **Environment variables**: leave empty
6. Click **Save and Deploy**.

Cloudflare runs the build (no-op since no command) and deploys. Takes ~30 seconds.

## 7. Open the live site

1. After deploy succeeds, click the URL Cloudflare shows you, e.g. `https://teamstats.pages.dev` or `https://teamstats-xxx.pages.dev`.
2. You should see:
   - Navy top bar with "TeamStats" wordmark + gold accent stripe
   - A white card titled **"TeamStats — Phase 2"**
   - `DB: connected (0 public teams)` ← confirms Supabase URL + key are correct and RLS is working
   - `Auth: not signed in (anon)` ← confirms auth is wired up but no session yet
3. On your **Pixel**, open the same URL in Chrome → tap menu → **Add to Home screen** → Install.

If `DB:` shows `error — ...`, paste the error text and I'll diagnose.

## 8. Daily workflow from here

Any time we change a file in `teamstats/`, you push it:

```powershell
cd "C:\Users\mgrea\OneDrive\Desktop\Spreadsheet for stats\teamstats"
git add .
git commit -m "<short description>"
git push
```

Cloudflare auto-deploys within 30 seconds. No more "Manage deployments → New version" rituals — just push.

---

When the live site shows the Phase 2 card with both lines green, paste the URL back to me and we'll move to Phase 3 (auth flows).
