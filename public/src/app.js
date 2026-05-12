// TeamStats — entry point.
// Phases done so far: 2 (skeleton) · 3 (magic-link auth) · 4 (create-team wizard).
// Next: roster + schedule CRUD, then port the existing Teddy 10U views.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function applyTheme(team) {
  const root = document.documentElement;
  if (team?.primary_color) root.style.setProperty('--navy', team.primary_color);
  if (team?.accent_color)  root.style.setProperty('--gold', team.accent_color);
}

/* ================= ROUTING ================= */
// Hash routes: #/signin, #/new, #/t/<slug>, #/picker
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', args: parts.slice(1) };
}

async function route() {
  const r = currentRoute();
  const { data: { session } } = await supabase.auth.getSession();

  // Not signed in → only the sign-in view makes sense.
  if (!session) { renderSignIn(); return; }

  // Signed in. Decide where to land if user typed bare URL.
  if (!r.name) {
    const memberships = await fetchMyTeams(session.user.id);
    if (memberships.length === 0) { location.hash = '#/new'; return; }
    if (memberships.length === 1) { location.hash = '#/t/' + memberships[0].teams.slug; return; }
    location.hash = '#/picker'; return;
  }

  if (r.name === 'new')     return renderCreateTeam(session);
  if (r.name === 'picker')  return renderTeamPicker(session);
  if (r.name === 't')       return renderTeamHome(r.args[0], session);

  renderNotFound();
}

async function fetchMyTeams(userId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, slug, name, primary_color, accent_color)')
    .eq('user_id', userId);
  if (error) { console.error(error); return []; }
  return data || [];
}

/* ================= VIEW: SIGN IN ================= */
function renderSignIn() {
  applyTheme(null);
  $('#app').innerHTML = `
    <div class="card">
      <h1>Welcome to TeamStats</h1>
      <p>Enter your email — we'll send you a one-click sign-in link. No password to remember.</p>
      <form id="signin-form" class="auth-form">
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email"
               placeholder="you@example.com">
        <button type="submit" class="primary">Send sign-in link</button>
        <div id="signin-status" class="muted small"></div>
      </form>
    </div>`;

  $('#signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const status = $('#signin-status');
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Sending…';
    status.textContent = ''; status.classList.remove('error');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + '/' },
      });
      if (error) throw error;
      status.innerHTML =
        `Check <strong>${escapeHtml(email)}</strong> for a sign-in link. ` +
        `It usually arrives in under a minute — also peek at spam if it doesn't.`;
      btn.style.display = 'none';
    } catch (err) {
      status.textContent = 'Error: ' + (err.message || err);
      status.classList.add('error');
      btn.disabled = false; btn.textContent = 'Send sign-in link';
    }
  });
}

/* ================= VIEW: CREATE TEAM ================= */
function renderCreateTeam(session) {
  applyTheme(null);
  $('#app').innerHTML = `
    <div class="card">
      <h1>Create your team</h1>
      <p class="muted">A few details to get started. You can change everything later.</p>
      <form id="new-team-form" class="auth-form">
        <label for="t-name">Team name</label>
        <input id="t-name" type="text" required maxlength="80"
               placeholder="e.g. Teddy 10U 2026">

        <label for="t-slug">URL slug</label>
        <input id="t-slug" type="text" required maxlength="60" pattern="[a-z0-9\\-]+"
               placeholder="auto-suggested from name">
        <div class="muted small">Your team URL will be <code>${escapeHtml(window.location.origin)}/#/t/<span id="slug-preview">…</span></code></div>

        <label for="t-season">Season (optional)</label>
        <input id="t-season" type="text" maxlength="40" placeholder="e.g. 2026 Spring">

        <div class="color-row">
          <div>
            <label for="t-pcolor">Primary color</label>
            <input id="t-pcolor" type="color" value="#1f3864">
          </div>
          <div>
            <label for="t-acolor">Accent color</label>
            <input id="t-acolor" type="color" value="#c9a227">
          </div>
        </div>

        <button type="submit" class="primary">Create team</button>
        <button type="button" id="cancel-create" class="secondary">Sign out</button>
        <div id="new-team-status" class="muted small"></div>
      </form>
    </div>`;

  const nameEl = $('#t-name'), slugEl = $('#t-slug'), preview = $('#slug-preview');
  // Live-sync the slug field while the user types in the name, until the user
  // manually edits the slug (then we stop auto-overwriting).
  let slugTouched = false;
  nameEl.addEventListener('input', () => {
    if (!slugTouched) { slugEl.value = slugify(nameEl.value); preview.textContent = slugEl.value || '…'; }
  });
  slugEl.addEventListener('input', () => {
    slugTouched = true;
    slugEl.value = slugify(slugEl.value);
    preview.textContent = slugEl.value || '…';
  });

  $('#cancel-create').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  $('#new-team-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameEl.value.trim();
    const slug = slugify(slugEl.value || nameEl.value);
    if (!slug) return;
    const payload = {
      name,
      slug,
      season: $('#t-season').value.trim() || null,
      primary_color: $('#t-pcolor').value,
      accent_color:  $('#t-acolor').value,
      is_public: true,
      created_by: session.user.id,
    };
    const status = $('#new-team-status');
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Creating…';
    status.textContent = ''; status.classList.remove('error');
    try {
      const { data, error } = await supabase
        .from('teams')
        .insert(payload)
        .select()
        .single();
      if (error) {
        if (String(error.message || '').includes('duplicate key')) {
          throw new Error('That URL slug is already taken — try a different one.');
        }
        throw error;
      }
      // Trigger added us to team_members automatically.
      location.hash = '#/t/' + data.slug;
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
      btn.disabled = false; btn.textContent = 'Create team';
    }
  });
}

/* ================= VIEW: TEAM PICKER (multi-team) ================= */
async function renderTeamPicker(session) {
  applyTheme(null);
  const memberships = await fetchMyTeams(session.user.id);
  const list = memberships.map(m => `
    <a href="#/t/${encodeURIComponent(m.teams.slug)}" class="team-pick">
      <span class="dot" style="background:${escapeHtml(m.teams.primary_color || '#1f3864')}"></span>
      <span class="team-name">${escapeHtml(m.teams.name)}</span>
      <span class="role muted small">${escapeHtml(m.role)}</span>
    </a>`).join('');
  $('#app').innerHTML = `
    <div class="card">
      <h1>Your teams</h1>
      ${list}
      <a href="#/new" class="secondary block">+ Create another team</a>
      <button id="signout-btn" class="secondary">Sign out</button>
    </div>`;
  $('#signout-btn').addEventListener('click', async () => { await supabase.auth.signOut(); });
}

/* ================= VIEW: TEAM HOME (placeholder until Phase 5) ================= */
async function renderTeamHome(slug, session) {
  if (!slug) { location.hash = '#/'; return; }
  const { data: team, error } = await supabase
    .from('teams')
    .select('id, slug, name, primary_color, accent_color, season')
    .eq('slug', slug)
    .single();
  if (error || !team) {
    $('#app').innerHTML = `<div class="card error">Team not found: <code>${escapeHtml(slug)}</code></div>`;
    return;
  }
  applyTheme(team);
  $('#app').innerHTML = `
    <div class="card">
      <h1>${escapeHtml(team.name)}</h1>
      ${team.season ? `<p class="muted">${escapeHtml(team.season)}</p>` : ''}
      <p>Your team exists ✓. Phase 5 (next session) adds roster + schedule editors, and we'll start porting the Teddy 10U views right after.</p>
      <p class="muted small">Public team URL (share with parents): <code>${escapeHtml(window.location.origin)}/#/t/${escapeHtml(team.slug)}</code></p>
      <button id="signout-btn" class="secondary">Sign out</button>
    </div>`;
  $('#signout-btn').addEventListener('click', async () => { await supabase.auth.signOut(); });
}

/* ================= VIEW: NOT FOUND ================= */
function renderNotFound() {
  $('#app').innerHTML = `
    <div class="card">
      <h1>Not found</h1>
      <a href="#/" class="secondary">Go home</a>
    </div>`;
}

/* ================= INIT ================= */
supabase.auth.onAuthStateChange(() => { route(); });
window.addEventListener('hashchange', () => { route(); });

route().catch((err) => {
  $('#app').innerHTML = `<div class="card error">Boot failed: ${escapeHtml(err.message || err)}</div>`;
  console.error(err);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
