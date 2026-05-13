// TeamStats — entry point.
// Phases done: 2 (skeleton) · 3 (magic-link auth) · 4 (create-team wizard) · 5 (roster + schedule CRUD).
// Up next: 6 (game log + team batting), 7 (player profile), 8 (lineup builder),
//          9 (settings + theming), 10 (migrate Teddy data + ship).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function applyTheme(team) {
  const root = document.documentElement;
  root.style.setProperty('--navy', team?.primary_color || '#1f3864');
  root.style.setProperty('--gold', team?.accent_color  || '#c9a227');
  // Logo slots in the top bar
  const L = document.getElementById('topbar-logo-left');
  const R = document.getElementById('topbar-logo-right');
  if (L) {
    if (team?.logo_url)        { L.src = team.logo_url; L.hidden = false; }
    else                        { L.hidden = true; L.removeAttribute('src'); }
  }
  if (R) {
    if (team?.league_logo_url) {
      R.src = team.league_logo_url; R.hidden = false;
      // Wrap (or unwrap) in an anchor based on whether a league_url is set
      const parentIsLink = R.parentElement && R.parentElement.tagName === 'A';
      if (team.league_url) {
        if (parentIsLink) {
          R.parentElement.href = team.league_url;
        } else {
          const a = document.createElement('a');
          a.href = team.league_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.className = 'topbar-logo-link';
          R.parentNode.insertBefore(a, R); a.appendChild(R);
        }
      } else if (parentIsLink) {
        // Strip the wrapping anchor if league_url was cleared
        const a = R.parentElement;
        a.parentNode.insertBefore(R, a); a.remove();
      }
    } else {
      R.hidden = true; R.removeAttribute('src');
      const parentIsLink = R.parentElement && R.parentElement.tagName === 'A';
      if (parentIsLink) {
        const a = R.parentElement;
        a.parentNode.insertBefore(R, a); a.remove();
      }
    }
  }
}
function setBrand(text) { const b = $('.brand'); if (b) b.textContent = text; }
function setSubtitle(text) { const s = $('.team-subtitle'); if (s) s.textContent = text || ''; }
function showTeamNav(team, role, activeTab) {
  const nav = $('#bottomnav');
  nav.hidden = false;
  const slugSafe = encodeURIComponent(team.slug);
  const map = {
    team:     `#/t/${slugSafe}`,
    schedule: `#/t/${slugSafe}/schedule`,
    players:  `#/t/${slugSafe}/players`,
    log:      `#/t/${slugSafe}/log`,
    lineup:   `#/t/${slugSafe}/lineup`,
    entry:    `#/t/${slugSafe}/entry/new`,
  };
  $$('#bottomnav a').forEach(a => {
    const tab = a.dataset.tab;
    a.href = map[tab] || '#/';
    a.hidden = (tab === 'entry' && !isWriter(role));
    a.classList.toggle('active', tab === activeTab);
  });
  document.body.classList.remove('no-nav');
}
function hideTeamNav() {
  $('#bottomnav').hidden = true;
  document.body.classList.add('no-nav');
  setBrand('TeamStats');
  setSubtitle('');
}

/** Compute "W-L (-T)" and "Next: M/D vs X" from the team's games table. */
async function loadTopbarSummary(team) {
  const { data: games } = await supabase
    .from('games')
    .select('date, result, opponent, home_away')
    .eq('team_id', team.id);
  if (!games) return { record: '', next: '' };
  let w = 0, l = 0, t = 0;
  games.forEach(g => {
    if (g.result === 'W') w++;
    else if (g.result === 'L') l++;
    else if (g.result === 'T') t++;
  });
  const record = (w || l || t)
    ? (`${w}-${l}` + (t ? `-${t}` : ''))
    : '';
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = games
    .filter(g => !g.result && g.date && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const next = upcoming
    ? `Next: ${dateToMD(upcoming.date)} ${upcoming.home_away === 'away' ? '@' : 'vs'} ${upcoming.opponent || ''}`.trim()
    : '';
  return { record, next };
}
function fmtAvg(x) {
  if (!isFinite(x) || x == null) return '.000';
  if (x >= 1) return x.toFixed(3);
  return x.toFixed(3).replace(/^0\./, '.');
}

/* ================= IMAGE HELPERS ================= */
/** Downscale a phone photo. Keeps PNG (preserving transparency) when source is PNG;
 *  otherwise outputs JPEG at the given quality. */
async function resizeImageToBlob(file, maxDim = 800, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  // Some pickers report empty file.type — fall back to extension sniff
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name || '');
  const type = isPng ? 'image/png' : 'image/jpeg';
  if (canvas.convertToBlob) {
    return await canvas.convertToBlob(isPng ? { type } : { type, quality });
  }
  return await new Promise((res) =>
    isPng ? canvas.toBlob(res, type) : canvas.toBlob(res, type, quality)
  );
}
/** Upload an arbitrary image to the `logos` bucket at a given path; return public URL.
 *  Content-type follows the uploaded blob (PNG stays PNG, others become JPEG). */
async function uploadImageToLogos(path, file, opts = {}) {
  const blob = await resizeImageToBlob(file, opts.maxDim || 800, opts.quality || 0.85);
  const up = await supabase.storage.from('logos').upload(path, blob, {
    contentType: blob.type, upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = supabase.storage.from('logos').getPublicUrl(path);
  return pub.publicUrl + '?v=' + Date.now();
}
/** Upload a player headshot and update players.photo_url. */
async function uploadPlayerPhoto(team, playerId, file) {
  const url = await uploadImageToLogos(`players/${team.id}/${playerId}.jpg`, file);
  const upd = await supabase.from('players').update({ photo_url: url }).eq('id', playerId);
  if (upd.error) throw upd.error;
  return url;
}

/* ================= BR-SHORTHAND PARSER (port from Apps Script) ================= */
const ALIASES = {
  'BB':'BB','HBP':'HBP','R':'R','RBI':'RBI','SB':'SB','S':'SB',
  '1B':'1B','2B':'2B','3B':'3B','HR':'HR',
  'RUN':'R','RUNS':'R','WALK':'BB','WALKS':'BB',
  'K':'K','KS':'K',                    // swinging strikeout
  'KL':'K_LOOKING','KC':'K_LOOKING',   // called / looking strikeout (backwards-K)
};
function parseNote(text) {
  const empty = {AB:0,H:0,'1B':0,'2B':0,'3B':0,HR:0,BB:0,HBP:0,R:0,RBI:0,SB:0,K:0,K_LOOKING:0};
  if (!text) return { stats: empty, played: false };
  let norm = String(text).replace(/(\d+)(1B|2B|3B|HR)\b/g, '$1 $2');
  const s = Object.assign({}, empty);
  norm.split(/[,;]/).forEach((raw) => {
    const tok = raw.trim();
    if (!tok) return;
    let m;
    if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(tok))) {
      s.H += parseInt(m[1], 10); s.AB += parseInt(m[2], 10); return;
    }
    if ((m = /^(\d+)\s+([A-Za-z0-9]+)$/.exec(tok))) {
      const n = parseInt(m[1], 10), name = m[2].toUpperCase();
      if (ALIASES[name]) { s[ALIASES[name]] += n; return; }
    }
    if ((m = /^(\d+)([A-Za-z][A-Za-z0-9]*)$/.exec(tok))) {
      const n = parseInt(m[1], 10), name = m[2].toUpperCase();
      if (ALIASES[name]) { s[ALIASES[name]] += n; return; }
    }
    const u = tok.toUpperCase().replace(/\s+/g, '');
    if (ALIASES[u]) s[ALIASES[u]] += 1;
  });
  const typed = s['1B'] + s['2B'] + s['3B'] + s.HR;
  if (typed < s.H) s['1B'] += s.H - typed;
  // Strikeouts are at-bats but most coaches won't separately list "0-1, K".
  // If user typed "K" or "KL" without an explicit X-Y, count those toward AB.
  const Ks = s.K + s.K_LOOKING;
  const accountedAB = s.AB;
  if (Ks > 0 && accountedAB < (s.H + Ks)) {
    s.AB = s.H + Ks;   // bring AB up to at least cover hits + strikeouts
  }
  return { stats: s, played: true };
}
function toast(msg, isError) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
/** "M/D" for a date input ("2026-05-13" → "5/13"). */
function dateToMD(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return Number(m[2]) + '/' + Number(m[3]);
}
/** "yyyy-mm-dd" for a `<input type="date">` from a Postgres date string. */
function dateToISO(d) {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return '';
}

/* ================= DATA HELPERS ================= */
async function fetchMyTeams(userId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, slug, name, primary_color, accent_color)')
    .eq('user_id', userId);
  if (error) { console.error(error); return []; }
  return data || [];
}
async function loadTeamBySlug(slug) {
  const { data, error } = await supabase
    .from('teams')
    .select('id, slug, name, primary_color, accent_color, season, logo_url, league_logo_url, league_url, is_public, hidden_stat_cols')
    .eq('slug', slug)
    .single();
  if (error) return null;
  return data;
}
async function loadMyRole(teamId, userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return data?.role || null;
}
const isWriter = (role) => role === 'owner' || role === 'coach';

/* ================= ROUTING =================
 * Hash routes:
 *   #/                      → root (redirects based on auth/teams)
 *   #/signin                → email link form
 *   #/new                   → create team
 *   #/picker                → multi-team picker
 *   #/t/<slug>              → team home
 *   #/t/<slug>/player/new   → add player (coach)
 *   #/t/<slug>/player/<id>  → edit player (coach)
 *   #/t/<slug>/game/new     → add game (coach)
 *   #/t/<slug>/game/<id>    → edit game (coach)
 */
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts };
}
async function route() {
  const { parts } = currentRoute();
  const { data: { session } } = await supabase.auth.getSession();
  const top = parts[0] || '';

  // Public team views still work without sign-in
  if (top === 't') return renderTeamRoute(parts.slice(1), session);
  // Join-team links work signed-in OR signed-out (we route to sign-in and then back)
  if (top === 'join') return renderJoinTeam(parts[1], session);

  // Auth-gated routes
  if (!session) { renderSignIn(); return; }

  if (top === '') {
    const memberships = await fetchMyTeams(session.user.id);
    if (memberships.length === 0)  { location.hash = '#/new'; return; }
    if (memberships.length === 1)  { location.hash = '#/t/' + memberships[0].teams.slug; return; }
    location.hash = '#/picker'; return;
  }
  if (top === 'new')    return renderCreateTeam(session);
  if (top === 'picker') return renderTeamPicker(session);
  if (top === 'signin') return renderSignIn();

  renderNotFound();
}
async function renderTeamRoute(args, session) {
  const slug = args[0];
  if (!slug) { location.hash = '#/'; return; }
  const team = await loadTeamBySlug(slug);
  if (!team) {
    hideTeamNav();
    applyTheme(null);
    $('#app').innerHTML = `<div class="card error">Team not found: <code>${escapeHtml(slug)}</code></div>`;
    return;
  }
  applyTheme(team);
  setBrand(team.name);
  // Run record + next-game in the topbar subtitle (fire and forget, doesn't block view)
  loadTopbarSummary(team).then(({ record, next }) => {
    const parts = [];
    if (record) parts.push(record);
    if (next)   parts.push(next);
    setSubtitle(parts.join('  ·  '));
  });
  const role = session ? await loadMyRole(team.id, session.user.id) : null;

  const sub  = args[1];
  const id   = args[2];
  const arg3 = args[3];

  // Tabbed views
  if (!sub)                  { showTeamNav(team, role, 'team');     return renderTeamBatting(team, role, session); }
  if (sub === 'schedule')    { showTeamNav(team, role, 'schedule'); return renderTeamSchedule(team, role, session); }
  if (sub === 'players' && !id) { showTeamNav(team, role, 'players'); return renderTeamPlayers(team, role, session); }
  if (sub === 'log')         { showTeamNav(team, role, 'log');      return renderTeamLog(team, role, session); }

  // Sub-forms (no active tab highlight or keep parent tab)
  if (sub === 'entry'  && id === 'new') { showTeamNav(team, role, 'entry');  return renderEntryForm(team, role, null); }
  if (sub === 'entry'  && id)           { showTeamNav(team, role, 'log');    return renderEntryForm(team, role, id); }
  if (sub === 'entry')                  { showTeamNav(team, role, 'entry');  return renderEntryForm(team, role, null); }
  if (sub === 'player' && id === 'new') { showTeamNav(team, role, 'players'); return renderPlayerForm(team, role, null); }
  if (sub === 'player' && id && arg3 === 'edit') { showTeamNav(team, role, 'players'); return renderPlayerForm(team, role, id); }
  if (sub === 'player' && id && arg3 === 'info') { showTeamNav(team, role, 'players'); return renderProfileInfoEdit(team, role, id); }
  if (sub === 'player' && id)           { showTeamNav(team, role, 'players'); return renderPlayerProfile(team, role, id, session); }
  if (sub === 'players' && id === 'import') { showTeamNav(team, role, 'players'); return renderPlayerImport(team, role); }
  if (sub === 'game'   && id === 'new') { showTeamNav(team, role, 'schedule'); return renderGameForm(team, role, null); }
  if (sub === 'game'   && id)           { showTeamNav(team, role, 'schedule'); return renderGameForm(team, role, id); }
  if (sub === 'games' && id === 'import'){ showTeamNav(team, role, 'schedule'); return renderGameImport(team, role); }
  if (sub === 'columns')                  { showTeamNav(team, role, 'team');     return renderColumnSettings(team, role); }
  if (sub === 'lineup' && !id)            { showTeamNav(team, role, 'lineup');   return renderLineupPicker(team, role); }
  if (sub === 'lineup' && id)             { showTeamNav(team, role, 'lineup');   return renderLineupBuilder(team, role, id); }
  if (sub === 'settings')                 { showTeamNav(team, role, 'team');     return renderSettings(team, role); }

  renderNotFound();
}

/* ================= VIEW: SIGN IN ================= */
function renderSignIn() {
  hideTeamNav();
  applyTheme(null);
  $('#app').innerHTML = `
    <div class="card">
      <h1>Welcome to TeamStats</h1>
      <p>Coaches and parents both sign in the same way. Enter your email and we'll send you a one-click link — no password to remember.</p>
      <p class="muted small">If you're a <strong>coach</strong>, signing in lets you create or manage your team.<br>
         If you're a <strong>parent</strong>, your coach should have sent you a "Join team" link — click that link first, then sign in from there.</p>
      <form id="signin-form" class="auth-form">
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email" placeholder="you@example.com">
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
        email, options: { emailRedirectTo: window.location.origin + '/' },
      });
      if (error) throw error;
      status.innerHTML = `Check <strong>${escapeHtml(email)}</strong> for a sign-in link.`;
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
  hideTeamNav();
  applyTheme(null);
  $('#app').innerHTML = `
    <div class="card">
      <h1>Create your team</h1>
      <p class="muted">A few details to get started. You can change everything later.</p>
      <form id="new-team-form" class="auth-form">
        <label for="t-name">Team name</label>
        <input id="t-name" type="text" required maxlength="80" placeholder="e.g. Teddy 10U 2026">

        <label for="t-slug">URL slug</label>
        <input id="t-slug" type="text" required maxlength="60" pattern="[a-z0-9\\-]+" placeholder="auto-suggested from name">
        <div class="muted small">Your team URL will be <code>${escapeHtml(window.location.origin)}/#/t/<span id="slug-preview">…</span></code></div>

        <label for="t-season">Season (optional)</label>
        <input id="t-season" type="text" maxlength="40" placeholder="e.g. 2026 Spring">

        <div class="color-row">
          <div><label for="t-pcolor">Primary color</label><input id="t-pcolor" type="color" value="#1f3864"></div>
          <div><label for="t-acolor">Accent color</label><input id="t-acolor" type="color" value="#c9a227"></div>
        </div>

        <button type="submit" class="primary">Create team</button>
        <button type="button" id="cancel-create" class="secondary">Sign out</button>
        <div id="new-team-status" class="muted small"></div>
      </form>
    </div>`;
  const nameEl = $('#t-name'), slugEl = $('#t-slug'), preview = $('#slug-preview');
  let slugTouched = false;
  nameEl.addEventListener('input', () => {
    if (!slugTouched) { slugEl.value = slugify(nameEl.value); preview.textContent = slugEl.value || '…'; }
  });
  slugEl.addEventListener('input', () => {
    slugTouched = true; slugEl.value = slugify(slugEl.value); preview.textContent = slugEl.value || '…';
  });
  $('#cancel-create').addEventListener('click', async () => { await supabase.auth.signOut(); });
  $('#new-team-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameEl.value.trim();
    const slug = slugify(slugEl.value || nameEl.value);
    const payload = {
      name, slug,
      season: $('#t-season').value.trim() || null,
      primary_color: $('#t-pcolor').value,
      accent_color:  $('#t-acolor').value,
      is_public: true,
      created_by: session.user.id,
    };
    const status = $('#new-team-status');
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const { data, error } = await supabase.from('teams').insert(payload).select().single();
      if (error) {
        if (String(error.message).includes('duplicate key')) {
          throw new Error('That URL slug is already taken — try a different one.');
        }
        throw error;
      }
      location.hash = '#/t/' + data.slug;
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
      btn.disabled = false; btn.textContent = 'Create team';
    }
  });
}

/* ================= VIEW: TEAM PICKER ================= */
async function renderTeamPicker(session) {
  hideTeamNav();
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

/* ================= COLUMN VISIBILITY ================= */
// All possible stat columns, in display order. `key` matches the player object
// keys built in renderTeamBatting; `dbKey` is the column name used in
// teams.hidden_stat_cols (Supabase column name conventions = lowercase).
const STAT_COLS = [
  { key: 'G',         dbKey: 'g',          label: 'G'   },
  { key: 'AB',        dbKey: 'ab',         label: 'AB'  },
  { key: 'R',         dbKey: 'r',          label: 'R'   },
  { key: 'H',         dbKey: 'h',          label: 'H'   },
  { key: '1B',        dbKey: 'b1',         label: '1B'  },
  { key: '2B',        dbKey: 'b2',         label: '2B'  },
  { key: 'HR',        dbKey: 'hr',         label: 'HR'  },
  { key: 'BB',        dbKey: 'bb',         label: 'BB'  },
  { key: 'HBP',       dbKey: 'hbp',        label: 'HBP' },
  { key: 'RBI',       dbKey: 'rbi',        label: 'RBI' },
  { key: 'SB',        dbKey: 'sb',         label: 'SB'  },
  { key: 'K',         dbKey: 'k',          label: 'K',  isAdvanced: true },
  { key: 'K_LOOKING', dbKey: 'k_looking',  label: 'ꓘ',  isAdvanced: true },
  { key: 'AVG',       dbKey: 'avg',        label: 'AVG' },
  { key: 'OBP',       dbKey: 'obp',        label: 'OBP' },
];
const PARENT_SHOWALL_LSKEY = (slug) => `teamstats:showall:${slug}`;
function parentShowsAll(slug) {
  try { return localStorage.getItem(PARENT_SHOWALL_LSKEY(slug)) === '1'; } catch { return false; }
}
function setParentShowsAll(slug, on) {
  try { localStorage.setItem(PARENT_SHOWALL_LSKEY(slug), on ? '1' : '0'); } catch {}
}
function visibleCols(team, role) {
  const hidden = new Set(team.hidden_stat_cols || []);
  if (isWriter(role)) return STAT_COLS;                 // coach always sees everything
  if (parentShowsAll(team.slug)) return STAT_COLS;       // parent opted in
  return STAT_COLS.filter(c => !hidden.has(c.dbKey));
}

/* ================= VIEW: TEAM BATTING (default tab) ================= */
async function renderTeamBatting(team, role, session) {
  const [{ data: players }, { data: logs }] = await Promise.all([
    supabase.from('players').select('id, first_name, last_name, jersey').eq('team_id', team.id),
    supabase.from('game_log').select('player_id, ab, r, h, b1, b2, b3, hr, bb, hbp, rbi, sb, k, k_looking, game_id').eq('team_id', team.id),
  ]);
  const playerMap = {};
  (players || []).forEach(p => {
    playerMap[p.id] = { id: p.id, first: p.first_name, last: p.last_name || '', jersey: p.jersey,
      G:0, AB:0, R:0, H:0, '1B':0, '2B':0, '3B':0, HR:0, BB:0, HBP:0, RBI:0, SB:0, K:0, K_LOOKING:0 };
  });
  (logs || []).forEach(r => {
    const p = playerMap[r.player_id]; if (!p) return;
    p.G++; p.AB += r.ab||0; p.R += r.r||0; p.H += r.h||0;
    p['1B'] += r.b1||0; p['2B'] += r.b2||0; p['3B'] += r.b3||0; p.HR += r.hr||0;
    p.BB += r.bb||0; p.HBP += r.hbp||0; p.RBI += r.rbi||0; p.SB += r.sb||0;
    p.K  += r.k||0;  p.K_LOOKING += r.k_looking||0;
  });
  const lines = Object.values(playerMap).map(p => {
    p.AVG = p.AB > 0 ? p.H / p.AB : 0;
    const denom = p.AB + p.BB + p.HBP;
    p.OBP = denom > 0 ? (p.H + p.BB + p.HBP) / denom : 0;
    return p;
  }).sort((a,b) => (b.AVG - a.AVG) || (b.H - a.H) || (b.AB - a.AB));

  const team_ = { G: new Set((logs||[]).map(r => r.game_id)).size,
    AB:0,R:0,H:0,'1B':0,'2B':0,'3B':0,HR:0,BB:0,HBP:0,RBI:0,SB:0,K:0,K_LOOKING:0 };
  (logs||[]).forEach(r => {
    team_.AB+=r.ab||0; team_.R+=r.r||0; team_.H+=r.h||0;
    team_['1B']+=r.b1||0; team_['2B']+=r.b2||0; team_['3B']+=r.b3||0; team_.HR+=r.hr||0;
    team_.BB+=r.bb||0; team_.HBP+=r.hbp||0; team_.RBI+=r.rbi||0; team_.SB+=r.sb||0;
    team_.K +=r.k||0;  team_.K_LOOKING += r.k_looking||0;
  });
  team_.AVG = team_.AB > 0 ? team_.H / team_.AB : 0;
  const d = team_.AB + team_.BB + team_.HBP;
  team_.OBP = d > 0 ? (team_.H + team_.BB + team_.HBP) / d : 0;

  const cols = visibleCols(team, role);
  const head = `<tr><th class="name">Player</th>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
  const cellFor = (p, col) =>
    (col.dbKey === 'avg' || col.dbKey === 'obp')
      ? fmtAvg(p[col.key])
      : (p[col.key] != null ? p[col.key] : 0);
  const body = lines.map(p =>
    `<tr><td class="name">${escapeHtml(p.first)} ${escapeHtml(p.last)}</td>` +
    cols.map(c => `<td>${cellFor(p, c)}</td>`).join('') +
    `</tr>`).join('');
  const totals =
    `<tr class="totals"><td class="name">Team Totals</td>` +
    cols.map(c => `<td>${cellFor(team_, c)}</td>`).join('') +
    `</tr>`;

  // Build the small "show all / hide" controls under the table
  const hidden = (team.hidden_stat_cols || []);
  const writer = isWriter(role);
  let controlsHtml = '';
  if (writer) {
    controlsHtml = `
      <a href="#/t/${encodeURIComponent(team.slug)}/settings" class="secondary block">⚙ Team settings (name, colors, logos)</a>
      <a href="#/t/${encodeURIComponent(team.slug)}/columns" class="secondary block">⚙ Column visibility</a>`;
  } else if (hidden.length) {
    const showing = parentShowsAll(team.slug);
    controlsHtml = `<button id="toggle-showall" class="secondary block">${showing ? 'Hide advanced stats' : 'Show advanced stats'}</button>`;
  }

  const empty = !lines.length ? `<p class="muted small">No roster yet. Tap Players to add some.</p>` : '';

  $('#app').innerHTML = `
    <div class="section-title">Standard Batting</div>
    ${empty}
    ${lines.length ? `<div class="table-wrap"><table class="stats"><thead>${head}</thead><tbody>${body}${totals}</tbody></table></div>` : ''}
    ${controlsHtml ? `<div class="card">${controlsHtml}</div>` : ''}
    ${session ? `<div class="card"><button id="signout-btn" class="secondary">Sign out</button></div>` : ''}`;
  const tog = $('#toggle-showall');
  if (tog) tog.addEventListener('click', () => {
    setParentShowsAll(team.slug, !parentShowsAll(team.slug));
    renderTeamBatting(team, role, session);
  });
  const so = $('#signout-btn');
  if (so) so.addEventListener('click', async () => { await supabase.auth.signOut(); });
}

/* ================= VIEW: COLUMN VISIBILITY (coach-only) ================= */
async function renderColumnSettings(team, role) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Coaches only.</div>`;
    return;
  }
  const hidden = new Set(team.hidden_stat_cols || []);
  $('#app').innerHTML = `
    <div class="card">
      <h1>Column visibility</h1>
      <p class="muted small">Uncheck a column to hide it from the parent view by default. Parents can still tap "Show advanced stats" to see them.</p>
      <form id="cols-form" class="auth-form">
        ${STAT_COLS.map(c => `
          <label class="check-row">
            <input type="checkbox" data-col="${c.dbKey}" ${hidden.has(c.dbKey) ? '' : 'checked'}>
            <span>${escapeHtml(c.label)}${c.isAdvanced ? ' <span class="muted small">(advanced)</span>' : ''}</span>
          </label>`).join('')}
        <button type="submit" class="primary">Save</button>
        <a href="#/t/${encodeURIComponent(team.slug)}" class="secondary">Cancel</a>
        <div id="cv-status" class="muted small"></div>
      </form>
    </div>`;
  $('#cols-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newHidden = Array.from(document.querySelectorAll('input[data-col]'))
      .filter(i => !i.checked).map(i => i.dataset.col);
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { error } = await supabase.from('teams').update({ hidden_stat_cols: newHidden }).eq('id', team.id);
      if (error) throw error;
      toast('Visibility saved');
      location.hash = '#/t/' + encodeURIComponent(team.slug);
    } catch (err) {
      $('#cv-status').textContent = err.message || String(err);
      $('#cv-status').classList.add('error');
      btn.disabled = false; btn.textContent = 'Save';
    }
  });
}

/* ================= VIEW: SCHEDULE TAB ================= */
async function renderTeamSchedule(team, role, session) {
  const writer = isWriter(role);
  const { data: games } = await supabase
    .from('games').select('id, date, opponent, home_away, location, result, our_score, their_score')
    .eq('team_id', team.id).order('date', { ascending: true });
  const resultBadge = (g) => {
    const score = (g.our_score != null && g.their_score != null) ? ` ${g.our_score}-${g.their_score}` : '';
    if (g.result === 'W') return `<span class="badge win">W${score}</span>`;
    if (g.result === 'L') return `<span class="badge loss">L${score}</span>`;
    if (g.result === 'T') return `<span class="badge tie">T${score}</span>`;
    return '';
  };
  const rows = (games || []).map(g => `
    <li class="row-item">
      <span class="jersey">${escapeHtml(dateToMD(g.date))}</span>
      <span class="row-main">${escapeHtml(g.opponent || '')}</span>
      <span class="row-meta muted">${g.home_away === 'away' ? '@' : 'vs'}</span>
      ${resultBadge(g)}
      ${writer ? `<a href="#/t/${encodeURIComponent(team.slug)}/game/${encodeURIComponent(g.id)}" class="edit-btn">✎</a>` : ''}
    </li>`).join('');
  const empty = !games?.length ? `<p class="muted small">No games yet${writer ? ' — tap + Add to add one.' : '.'}</p>` : '';
  $('#app').innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Schedule</h2>
        ${writer ? `
          <span class="add-group">
            <a href="#/t/${encodeURIComponent(team.slug)}/game/new" class="add-btn">+ Add</a>
            <a href="#/t/${encodeURIComponent(team.slug)}/games/import" class="add-btn ghost">Import</a>
          </span>` : ''}
      </div>
      ${empty || `<ul class="row-list">${rows}</ul>`}
    </div>`;
}

/* ================= VIEW: PLAYERS TAB ================= */
async function renderTeamPlayers(team, role, session) {
  const writer = isWriter(role);
  const { data: players } = await supabase
    .from('players').select('id, first_name, last_name, jersey, position, display_order, photo_url')
    .eq('team_id', team.id).order('display_order', { ascending: true }).order('jersey', { ascending: true });
  const slugSafe = encodeURIComponent(team.slug);
  const rows = (players || []).map(p => `
    <li class="row-item">
      ${p.photo_url
        ? `<img class="row-avatar" src="${escapeHtml(p.photo_url)}" alt="">`
        : '<span class="row-avatar placeholder"></span>'}
      ${p.jersey ? `<span class="jersey">#${escapeHtml(p.jersey)}</span>` : '<span class="jersey muted">—</span>'}
      <a href="#/t/${slugSafe}/player/${encodeURIComponent(p.id)}" class="row-main row-link">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</a>
      ${p.position ? `<span class="row-meta muted">${escapeHtml(p.position)}</span>` : ''}
      ${writer ? `<a href="#/t/${slugSafe}/player/${encodeURIComponent(p.id)}/edit" class="edit-btn">✎</a>` : ''}
    </li>`).join('');
  const empty = !players?.length ? `<p class="muted small">No players yet${writer ? ' — tap + Add to add one.' : '.'}</p>` : '';
  $('#app').innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Roster</h2>
        ${writer ? `
          <span class="add-group">
            <a href="#/t/${slugSafe}/player/new" class="add-btn">+ Add</a>
            <a href="#/t/${slugSafe}/players/import" class="add-btn ghost">Import</a>
          </span>` : ''}
      </div>
      ${empty || `<ul class="row-list">${rows}</ul>`}
    </div>`;
}

/* ================= VIEW: GAME LOG TAB ================= */
async function renderTeamLog(team, role, session) {
  const writer = isWriter(role);
  const [{ data: logs }, { data: players }, { data: games }] = await Promise.all([
    supabase.from('game_log').select('*').eq('team_id', team.id),
    supabase.from('players').select('id, first_name, last_name, jersey').eq('team_id', team.id),
    supabase.from('games').select('id, date, opponent, home_away').eq('team_id', team.id),
  ]);
  const pMap = {}, gMap = {};
  (players || []).forEach(p => pMap[p.id] = p);
  (games   || []).forEach(g => gMap[g.id] = g);
  // Sort newest game first, then player name
  const sorted = (logs || []).slice().sort((a, b) => {
    const da = gMap[a.game_id]?.date || '';
    const db = gMap[b.game_id]?.date || '';
    if (db !== da) return db.localeCompare(da);
    const na = (pMap[a.player_id]?.first_name || '') + (pMap[a.player_id]?.last_name || '');
    const nb = (pMap[b.player_id]?.first_name || '') + (pMap[b.player_id]?.last_name || '');
    return na.localeCompare(nb);
  });
  const empty = !sorted.length ? `<p class="muted small">No stat entries yet${writer ? ' — tap + Add to enter your first game.' : '.'}</p>` : '';
  const cols = visibleCols(team, role);
  const showCol = (dbKey) => cols.some(c => c.dbKey === dbKey);
  const cards = sorted.map(r => {
    const p = pMap[r.player_id]; const g = gMap[r.game_id];
    if (!p || !g) return '';
    const stats = [
      r.ab ? `${r.h}-${r.ab}` : null,
      r.hr ? `HR ${r.hr}` : null,
      r.bb ? `BB ${r.bb}` : null,
      r.hbp ? `HBP ${r.hbp}` : null,
      r.r ? `R ${r.r}` : null,
      r.rbi ? `RBI ${r.rbi}` : null,
      r.sb ? `SB ${r.sb}` : null,
      (r.k && showCol('k')) ? `K ${r.k}` : null,
      (r.k_looking && showCol('k_looking')) ? `ꓘ ${r.k_looking}` : null,
    ].filter(Boolean).join(' · ') || '—';
    return `
      <div class="log-card">
        <div class="top">
          <span class="who">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</span>
          <span class="when">${escapeHtml(dateToMD(g.date))} ${g.home_away === 'away' ? '@' : 'vs'} ${escapeHtml(g.opponent || '')}</span>
        </div>
        <div class="stats">${escapeHtml(stats)}</div>
        ${r.notes ? `<div class="nt">"${escapeHtml(r.notes)}"</div>` : ''}
        ${writer ? `<a href="#/t/${encodeURIComponent(team.slug)}/entry/${encodeURIComponent(r.id)}" class="edit-btn">Edit</a>` : ''}
      </div>`;
  }).join('');
  $('#app').innerHTML = `
    <div class="section-title">Game Log (${sorted.length})</div>
    ${empty}
    ${cards}`;
}

/* ================= VIEW: PLAYER PROFILE (public) ================= */
async function renderPlayerProfile(team, role, playerId, session) {
  const { data: player, error } = await supabase
    .from('players').select('*')
    .eq('id', playerId).eq('team_id', team.id).single();
  if (error || !player) {
    $('#app').innerHTML = `<div class="card error">Player not found. <a href="#/t/${encodeURIComponent(team.slug)}/players">Back to roster</a></div>`;
    return;
  }
  const writer = isWriter(role);
  const cols = visibleCols(team, role);
  const slugSafe = encodeURIComponent(team.slug);
  const playerIdSafe = encodeURIComponent(player.id);

  const [{ data: games }, { data: logs }] = await Promise.all([
    supabase.from('games').select('id, date, opponent, home_away').eq('team_id', team.id).order('date'),
    supabase.from('game_log').select('*').eq('team_id', team.id).eq('player_id', playerId),
  ]);
  const logByGame = {};
  (logs || []).forEach(r => { logByGame[r.game_id] = r; });
  const sortedGames = (games || []).slice().sort((a,b) => (a.date || '').localeCompare(b.date || ''));

  // Build season + cumulative
  let cum = { AB:0,R:0,H:0,'1B':0,'2B':0,HR:0,BB:0,HBP:0,RBI:0,SB:0,K:0,K_LOOKING:0 };
  const rowsBuilt = sortedGames.map(g => {
    const r = logByGame[g.id];
    if (r) {
      cum.AB+=r.ab||0; cum.R+=r.r||0; cum.H+=r.h||0;
      cum['1B']+=r.b1||0; cum['2B']+=r.b2||0; cum.HR+=r.hr||0;
      cum.BB+=r.bb||0; cum.HBP+=r.hbp||0; cum.RBI+=r.rbi||0; cum.SB+=r.sb||0;
      cum.K+=r.k||0;   cum.K_LOOKING+=r.k_looking||0;
    }
    return { g, r, cum: { ...cum } };
  });
  const season = { ...cum, G: rowsBuilt.filter(x => x.r).length };
  season.AVG = season.AB > 0 ? season.H / season.AB : 0;
  const d = season.AB + season.BB + season.HBP;
  season.OBP = d > 0 ? (season.H + season.BB + season.HBP) / d : 0;

  // Per-game stat cells, respecting hidden columns
  const cellCols = cols.filter(c => c.dbKey !== 'g');
  const cellVal = (log, cumLine, c) => {
    if (c.dbKey === 'avg') return log ? fmtAvg(cumLine.AB > 0 ? cumLine.H / cumLine.AB : 0) : '—';
    if (c.dbKey === 'obp') {
      if (!log) return '—';
      const dd = cumLine.AB + cumLine.BB + cumLine.HBP;
      return fmtAvg(dd > 0 ? (cumLine.H + cumLine.BB + cumLine.HBP) / dd : 0);
    }
    if (!log) return '—';
    const map = { ab: log.ab, r: log.r, h: log.h, b1: log.b1, b2: log.b2,
      hr: log.hr, bb: log.bb, hbp: log.hbp, rbi: log.rbi, sb: log.sb,
      k: log.k, k_looking: log.k_looking };
    return map[c.dbKey] || 0;
  };
  const head = `<tr><th>Date</th><th class="name">Opp</th>${cellCols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
  const tbody = rowsBuilt.map(({ g, r, cum: c }) =>
    `<tr><td>${escapeHtml(dateToMD(g.date))}</td><td class="name">${g.home_away === 'away' ? '@' : 'vs'} ${escapeHtml(g.opponent || '')}</td>` +
    cellCols.map(col => `<td>${cellVal(r, c, col)}</td>`).join('') + `</tr>`).join('');
  const seasonCells = cellCols.map(col => {
    if (col.dbKey === 'avg') return fmtAvg(season.AVG);
    if (col.dbKey === 'obp') return fmtAvg(season.OBP);
    const map = { ab: season.AB, r: season.R, h: season.H,
      b1: season['1B'], b2: season['2B'], hr: season.HR,
      bb: season.BB, hbp: season.HBP, rbi: season.RBI, sb: season.SB,
      k: season.K, k_looking: season.K_LOOKING };
    return map[col.dbKey] || 0;
  });
  const seasonRow = `<tr class="totals"><td>Season</td><td class="name"></td>` +
    seasonCells.map(c => `<td>${c}</td>`).join('') + `</tr>`;

  // Profile info card
  const handLabel = (v) => v === 'L' ? 'Left' : v === 'R' ? 'Right' : v === 'S' ? 'Switch' : '';
  const hasInfo = player.position || player.bats || player.throws || player.height
    || player.age || player.dob || player.favorite_color || player.bio;
  const editInfoBtn = writer
    ? `<a href="#/t/${slugSafe}/player/${playerIdSafe}/info" class="secondary block">Edit info</a>` : '';
  const profileCard = hasInfo ? `
    <div class="profile-card">
      ${player.jersey ? `<div class="prof-jersey">#${escapeHtml(player.jersey)}</div>` : ''}
      <dl class="prof-list">
        ${player.position ? `<dt>Position</dt><dd>${escapeHtml(player.position)}</dd>` : ''}
        ${player.bats ? `<dt>Bats</dt><dd>${escapeHtml(handLabel(player.bats))}</dd>` : ''}
        ${player.throws ? `<dt>Throws</dt><dd>${escapeHtml(handLabel(player.throws))}</dd>` : ''}
        ${player.height ? `<dt>Height</dt><dd>${escapeHtml(player.height)}</dd>` : ''}
        ${player.age ? `<dt>Age</dt><dd>${escapeHtml(player.age)}</dd>` : ''}
        ${player.dob ? `<dt>Born</dt><dd>${escapeHtml(player.dob)}</dd>` : ''}
        ${player.favorite_color ? `<dt>Favorite color</dt><dd><span class="swatch" style="background:${escapeHtml(player.favorite_color)}"></span> ${escapeHtml(player.favorite_color)}</dd>` : ''}
      </dl>
      ${player.bio ? `<div class="prof-bio">"${escapeHtml(player.bio)}"</div>` : ''}
      ${editInfoBtn}
    </div>` : `
    <div class="profile-card empty">
      <p>No info on ${escapeHtml(player.first_name)} yet${writer ? '' : '.'}</p>
      ${writer ? `<a href="#/t/${slugSafe}/player/${playerIdSafe}/info" class="add-btn">Add player info</a>` : ''}
    </div>`;

  // Title bar: full name centered with optional jersey badge
  setBrand(`${player.first_name} ${player.last_name || ''}${player.jersey ? '  #' + player.jersey : ''}`);

  const heroPhoto = player.photo_url
    ? `<div class="player-hero"><img class="player-photo" src="${escapeHtml(player.photo_url)}" alt="${escapeHtml(player.first_name)}"></div>`
    : '';

  $('#app').innerHTML = `
    ${heroPhoto}
    <div class="summary-chips">
      <span class="chip">G ${season.G}</span>
      <span class="chip">AB ${season.AB}</span>
      <span class="chip">H ${season.H}</span>
      <span class="chip">BB ${season.BB}</span>
      <span class="chip">R ${season.R}</span>
      <span class="chip">RBI ${season.RBI}</span>
      <span class="chip">SB ${season.SB}</span>
      <span class="chip avg">AVG ${fmtAvg(season.AVG)}</span>
      <span class="chip avg">OBP ${fmtAvg(season.OBP)}</span>
    </div>
    <div class="section-title">Game Log</div>
    <div class="table-wrap"><table class="stats"><thead>${head}</thead><tbody>${tbody}${seasonRow}</tbody></table></div>
    <div class="section-title">Player Info</div>
    ${profileCard}`;
}

/* ================= VIEW: PROFILE INFO EDIT (coach-only for now) ================= */
async function renderProfileInfoEdit(team, role, playerId) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Editing player info is coach-only for now. <a href="#/t/${encodeURIComponent(team.slug)}/player/${encodeURIComponent(playerId)}">Back</a></div>`;
    return;
  }
  const { data: player, error } = await supabase
    .from('players').select('*').eq('id', playerId).eq('team_id', team.id).single();
  if (error || !player) {
    $('#app').innerHTML = `<div class="card error">Player not found.</div>`;
    return;
  }
  const slugSafe = encodeURIComponent(team.slug);
  const playerIdSafe = encodeURIComponent(player.id);
  const v = (k) => escapeHtml(player[k] || '');
  $('#app').innerHTML = `
    <div class="card">
      <h1>Edit info for ${escapeHtml(player.first_name)} ${escapeHtml(player.last_name || '')}</h1>
      <form id="info-form" class="auth-form">
        <label>Photo (optional)</label>
        <div class="photo-row">
          ${player.photo_url
            ? `<img id="photo-preview" class="player-photo small" src="${escapeHtml(player.photo_url)}" alt="">`
            : `<div id="photo-preview" class="player-photo small placeholder">📷</div>`}
          <div class="photo-actions">
            <input id="if-photo" type="file" accept="image/*" capture="environment">
            ${player.photo_url ? '<button type="button" id="if-photo-clear" class="secondary small">Remove</button>' : ''}
          </div>
        </div>
        <div id="photo-status" class="muted small"></div>

        <div class="row">
          <div><label for="if-bats">Bats</label>
            <select id="if-bats">
              <option value=""  ${!player.bats ? 'selected' : ''}>—</option>
              <option value="L" ${player.bats==='L' ? 'selected' : ''}>Left</option>
              <option value="R" ${player.bats==='R' ? 'selected' : ''}>Right</option>
              <option value="S" ${player.bats==='S' ? 'selected' : ''}>Switch</option>
            </select></div>
          <div><label for="if-throws">Throws</label>
            <select id="if-throws">
              <option value=""  ${!player.throws ? 'selected' : ''}>—</option>
              <option value="L" ${player.throws==='L' ? 'selected' : ''}>Left</option>
              <option value="R" ${player.throws==='R' ? 'selected' : ''}>Right</option>
            </select></div>
        </div>
        <div class="row">
          <div><label for="if-height">Height</label>
            <input id="if-height" type="text" maxlength="20" value="${v('height')}" placeholder="e.g. 4'7&quot;"></div>
          <div><label for="if-age">Age</label>
            <input id="if-age" type="text" inputmode="numeric" maxlength="20" value="${v('age')}"></div>
        </div>
        <label for="if-dob">Birthday</label>
        <input id="if-dob" type="text" maxlength="20" value="${v('dob')}" placeholder="e.g. May 9 or 5/9">
        <label for="if-color">Favorite color</label>
        <input id="if-color" type="text" maxlength="50" value="${v('favorite_color')}" placeholder="e.g. teal or #ff66aa">
        <label for="if-bio">Bio (max 500 chars)</label>
        <textarea id="if-bio" maxlength="500" placeholder="Loves ice cream and stealing bases.">${v('bio')}</textarea>
        <button type="submit" class="primary">Save info</button>
        <a href="#/t/${slugSafe}/player/${playerIdSafe}" class="secondary">Cancel</a>
        <div id="if-status" class="muted small"></div>
      </form>
    </div>`;
  $('#info-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      bats:           $('#if-bats').value,
      throws:         $('#if-throws').value,
      height:         $('#if-height').value.trim(),
      age:            $('#if-age').value.trim(),
      dob:            $('#if-dob').value.trim(),
      favorite_color: $('#if-color').value.trim(),
      bio:            $('#if-bio').value.trim(),
    };
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { error: upErr } = await supabase.from('players').update(payload).eq('id', playerId);
      if (upErr) throw upErr;
      toast('Info saved');
      location.hash = '#/t/' + slugSafe + '/player/' + playerIdSafe;
    } catch (err) {
      console.error(err);
      $('#if-status').textContent = err.message || String(err);
      $('#if-status').classList.add('error');
      btn.disabled = false; btn.textContent = 'Save info';
    }
  });

  // Photo upload: fires immediately on file pick.
  const photoInput = $('#if-photo');
  const photoStatus = $('#photo-status');
  photoInput.addEventListener('change', async () => {
    const f = photoInput.files[0]; if (!f) return;
    photoStatus.textContent = 'Uploading…'; photoStatus.classList.remove('error');
    try {
      const url = await uploadPlayerPhoto(team, playerId, f);
      const preview = $('#photo-preview');
      if (preview.tagName === 'IMG') {
        preview.src = url;
      } else {
        preview.outerHTML = `<img id="photo-preview" class="player-photo small" src="${escapeHtml(url)}" alt="">`;
      }
      photoStatus.textContent = 'Photo updated. Tap Save info to commit any other changes.';
    } catch (err) {
      console.error(err);
      photoStatus.textContent = 'Upload failed: ' + (err.message || err);
      photoStatus.classList.add('error');
    }
  });
  const clearBtn = $('#if-photo-clear');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('Remove this player\'s photo?')) return;
    photoStatus.textContent = 'Removing…';
    try {
      const path = `players/${team.id}/${playerId}.jpg`;
      await supabase.storage.from('logos').remove([path]);          // best-effort
      const { error: upErr } = await supabase.from('players').update({ photo_url: null }).eq('id', playerId);
      if (upErr) throw upErr;
      photoStatus.textContent = 'Photo removed.';
      const preview = $('#photo-preview');
      preview.outerHTML = '<div id="photo-preview" class="player-photo small placeholder">📷</div>';
      clearBtn.remove();
    } catch (err) {
      photoStatus.textContent = 'Remove failed: ' + (err.message || err);
      photoStatus.classList.add('error');
    }
  });
}

/* ================= VIEW: ENTRY FORM (coach add/edit a player-game) ================= */
async function renderEntryForm(team, role, entryId) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Stat entry is for coaches only. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
    return;
  }
  // Load existing entry (if editing) + roster + schedule
  const [{ data: players }, { data: games }, entryRes] = await Promise.all([
    supabase.from('players').select('id, first_name, last_name, jersey').eq('team_id', team.id).order('first_name'),
    supabase.from('games').select('id, date, opponent').eq('team_id', team.id).order('date'),
    entryId ? supabase.from('game_log').select('*').eq('id', entryId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const existing = entryRes?.data || null;
  const initMode = existing ? 'manual' : 'quick';
  const v = (n) => existing ? (existing[n] ?? 0) : 0;
  const gameOpts = (games || []).map(g =>
    `<option value="${g.id}" ${existing && existing.game_id === g.id ? 'selected' : ''}>${escapeHtml(dateToMD(g.date))} ${escapeHtml(g.opponent || '')}</option>`).join('');
  const playerOpts = (players || []).map(p =>
    `<option value="${p.id}" ${existing && existing.player_id === p.id ? 'selected' : ''}>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</option>`).join('');

  // Pre-fill the manual fields from the existing note (if editing) or from
  // the row's already-saved values. parseNote handles auto-singles, etc.
  const initStats = existing
    ? { AB: existing.ab||0, R: existing.r||0, H: existing.h||0,
        '1B': existing.b1||0, '2B': existing.b2||0, HR: existing.hr||0,
        BB: existing.bb||0, HBP: existing.hbp||0, RBI: existing.rbi||0, SB: existing.sb||0,
        K: existing.k||0, K_LOOKING: existing.k_looking||0 }
    : { AB:0,R:0,H:0,'1B':0,'2B':0,HR:0,BB:0,HBP:0,RBI:0,SB:0,K:0,K_LOOKING:0 };
  // [dbKey, parseNoteStatsKey, displayLabel]
  const FIELD_MAP = [
    ['ab','AB','AB'], ['r','R','R'], ['h','H','H'],
    ['b1','1B','1B'], ['b2','2B','2B'], ['hr','HR','HR'],
    ['bb','BB','BB'], ['hbp','HBP','HBP'], ['rbi','RBI','RBI'], ['sb','SB','SB'],
    ['k','K','K'], ['k_looking','K_LOOKING','ꓘ']
  ];

  $('#app').innerHTML = `
    <div class="card">
      <h1>${existing ? 'Edit stats' : 'Add stats'}</h1>
      <form id="entry-form" class="auth-form">
        <label for="ef-game">Game</label>
        <select id="ef-game" required ${existing ? 'disabled' : ''}>${gameOpts}</select>
        <label for="ef-player">Player</label>
        <select id="ef-player" required ${existing ? 'disabled' : ''}>${playerOpts}</select>

        <label for="ef-note">Add game stats</label>
        <textarea id="ef-note" rows="3" placeholder="e.g. 1-3, BB, 2SB, R, RBI">${escapeHtml(existing ? (existing.notes || '') : '')}</textarea>
        <p class="muted small">Type shorthand above and the boxes below auto-fill. You can also edit any box directly.</p>

        <div class="manual-grid">
          ${FIELD_MAP.map(([k, sk, l]) =>
            `<div><label>${l}</label>
               <input type="number" min="0" value="${initStats[sk]}" data-mk="${k}"></div>`).join('')}
        </div>

        <button type="submit" class="primary">${existing ? 'Save changes' : 'Save row'}</button>
        ${existing ? '<button type="button" id="delete-entry" class="danger">Delete this entry</button>' : ''}
        <a href="#/t/${encodeURIComponent(team.slug)}/log" class="secondary">Cancel</a>
        <div id="ef-status" class="muted small"></div>
      </form>
    </div>`;

  const noteEl = $('#ef-note');
  const fillFromNote = () => {
    const { stats } = parseNote(noteEl.value);
    FIELD_MAP.forEach(([k, sk]) => {
      const inp = document.querySelector(`input[data-mk="${k}"]`);
      if (inp) inp.value = stats[sk] || 0;
    });
  };
  noteEl.addEventListener('input', fillFromNote);

  $('#entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const gameId = (existing ? existing.game_id : $('#ef-game').value);
    const playerId = (existing ? existing.player_id : $('#ef-player').value);
    const m = {};
    $$('input[data-mk]').forEach(i => m[i.dataset.mk] = parseInt(i.value, 10) || 0);
    const row = { team_id: team.id, game_id: gameId, player_id: playerId,
      ab: m.ab, r: m.r, h: m.h, b1: m.b1, b2: m.b2, b3: 0, hr: m.hr,
      bb: m.bb, hbp: m.hbp, rbi: m.rbi, sb: m.sb,
      k: m.k || 0, k_looking: m.k_looking || 0,
      notes: noteEl.value || null };
    if (row.h > row.ab) {
      $('#ef-status').textContent = 'H cannot exceed AB.';
      $('#ef-status').classList.add('error');
      return;
    }
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (existing) {
        const { error } = await supabase.from('game_log').update(row).eq('id', existing.id);
        if (error) throw error;
      } else {
        // Upsert on (game_id, player_id) so picking an existing combo edits it
        const { error } = await supabase.from('game_log').upsert(row, { onConflict: 'game_id,player_id' });
        if (error) throw error;
      }
      toast(existing ? 'Updated' : 'Saved');
      location.hash = '#/t/' + encodeURIComponent(team.slug) + '/log';
    } catch (err) {
      console.error(err);
      $('#ef-status').textContent = err.message || String(err);
      $('#ef-status').classList.add('error');
      btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Save row';
    }
  });

  const del = $('#delete-entry');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm('Delete this stat entry?')) return;
      try {
        const { error } = await supabase.from('game_log').delete().eq('id', existing.id);
        if (error) throw error;
        toast('Deleted');
        location.hash = '#/t/' + encodeURIComponent(team.slug) + '/log';
      } catch (err) {
        toast('Delete failed: ' + (err.message || err), true);
      }
    });
  }
}

/* ================= VIEW: PLAYER FORM (add or edit) ================= */
async function renderPlayerForm(team, role, playerId) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Only coaches can edit the roster. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
    return;
  }
  let existing = { first_name: '', last_name: '', jersey: '', position: '', display_order: 0 };
  if (playerId) {
    const { data, error } = await supabase
      .from('players')
      .select('id, first_name, last_name, jersey, position, display_order')
      .eq('id', playerId).single();
    if (error || !data) {
      $('#app').innerHTML = `<div class="card error">Player not found. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
      return;
    }
    existing = data;
  }
  $('#app').innerHTML = `
    <div class="card">
      <h1>${playerId ? 'Edit player' : 'Add player'}</h1>
      <form id="player-form" class="auth-form">
        <div class="color-row">
          <div><label for="pf-jersey">Jersey #</label>
            <input id="pf-jersey" type="text" maxlength="10" inputmode="numeric"
                   value="${escapeHtml(existing.jersey || '')}" placeholder="e.g. 7"></div>
          <div><label for="pf-pos">Position</label>
            <input id="pf-pos" type="text" maxlength="100"
                   value="${escapeHtml(existing.position || '')}" placeholder="e.g. SS / 2B"></div>
        </div>
        <label for="pf-first">First name</label>
        <input id="pf-first" type="text" required maxlength="60" value="${escapeHtml(existing.first_name || '')}">
        <label for="pf-last">Last name</label>
        <input id="pf-last" type="text" maxlength="60" value="${escapeHtml(existing.last_name || '')}">
        <button type="submit" class="primary">${playerId ? 'Save changes' : 'Add player'}</button>
        ${playerId ? '<button type="button" id="delete-player" class="danger">Delete this player</button>' : ''}
        <a href="#/t/${encodeURIComponent(team.slug)}/players" class="secondary">Cancel</a>
        <div id="pf-status" class="muted small"></div>
      </form>
    </div>`;

  $('#player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      team_id: team.id,
      first_name: $('#pf-first').value.trim(),
      last_name:  $('#pf-last').value.trim(),
      jersey:     $('#pf-jersey').value.trim() || null,
      position:   $('#pf-pos').value.trim() || null,
    };
    const status = $('#pf-status');
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (playerId) {
        const { error } = await supabase.from('players').update(payload).eq('id', playerId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('players').insert(payload);
        if (error) throw error;
      }
      toast(playerId ? 'Player updated' : 'Player added');
      location.hash = '#/t/' + encodeURIComponent(team.slug) + '/players';
    } catch (err) {
      console.error(err);
      status.textContent = err.message || String(err);
      status.classList.add('error');
      btn.disabled = false; btn.textContent = playerId ? 'Save changes' : 'Add player';
    }
  });

  const del = $('#delete-player');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm(`Delete ${existing.first_name} ${existing.last_name || ''}? This also removes their stats.`)) return;
      try {
        const { error } = await supabase.from('players').delete().eq('id', playerId);
        if (error) throw error;
        toast('Player deleted');
        location.hash = '#/t/' + encodeURIComponent(team.slug) + '/players';
      } catch (err) {
        toast('Delete failed: ' + (err.message || err), true);
      }
    });
  }
}

/* ================= VIEW: GAME FORM (add or edit) ================= */
async function renderGameForm(team, role, gameId) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Only coaches can edit the schedule. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
    return;
  }
  let existing = { date: '', opponent: '', home_away: 'home', location: '', game_time: '', result: '', our_score: null, their_score: null };
  if (gameId) {
    const { data, error } = await supabase
      .from('games').select('id, date, opponent, home_away, location, game_time, result, our_score, their_score')
      .eq('id', gameId).single();
    if (error || !data) {
      $('#app').innerHTML = `<div class="card error">Game not found. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
      return;
    }
    existing = data;
  }
  $('#app').innerHTML = `
    <div class="card">
      <h1>${gameId ? 'Edit game' : 'Add game'}</h1>
      <form id="game-form" class="auth-form">
        <label for="gf-date">Date</label>
        <input id="gf-date" type="date" required value="${escapeHtml(dateToISO(existing.date))}">
        <label for="gf-opp">Opponent</label>
        <input id="gf-opp" type="text" required maxlength="80" value="${escapeHtml(existing.opponent || '')}" placeholder="e.g. Westfield 10U">
        <label for="gf-ha">Home / Away</label>
        <select id="gf-ha">
          <option value="home" ${existing.home_away === 'home' ? 'selected' : ''}>Home</option>
          <option value="away" ${existing.home_away === 'away' ? 'selected' : ''}>Away</option>
        </select>
        <label for="gf-loc">Location (optional)</label>
        <input id="gf-loc" type="text" maxlength="120" value="${escapeHtml(existing.location || '')}" placeholder="e.g. Sadie Knox Playground">
        <label for="gf-time">Time (optional)</label>
        <input id="gf-time" type="time" value="${escapeHtml(existing.game_time || '')}">

        <hr class="muted-divider">

        <label for="gf-result">Result (after the game)</label>
        <select id="gf-result">
          <option value=""  ${!existing.result ? 'selected' : ''}>— Not played yet</option>
          <option value="W" ${existing.result === 'W' ? 'selected' : ''}>Win</option>
          <option value="L" ${existing.result === 'L' ? 'selected' : ''}>Loss</option>
          <option value="T" ${existing.result === 'T' ? 'selected' : ''}>Tie</option>
        </select>
        <div class="row">
          <div><label for="gf-our">Our score</label>
            <input id="gf-our" type="number" min="0" inputmode="numeric" value="${existing.our_score == null ? '' : existing.our_score}"></div>
          <div><label for="gf-their">Their score</label>
            <input id="gf-their" type="number" min="0" inputmode="numeric" value="${existing.their_score == null ? '' : existing.their_score}"></div>
        </div>

        <button type="submit" class="primary">${gameId ? 'Save changes' : 'Add game'}</button>
        ${gameId ? '<button type="button" id="delete-game" class="danger">Delete this game</button>' : ''}
        <a href="#/t/${encodeURIComponent(team.slug)}/schedule" class="secondary">Cancel</a>
        <div id="gf-status" class="muted small"></div>
      </form>
    </div>`;

  $('#game-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const intOrNull = (v) => {
      const t = String(v ?? '').trim();
      if (!t) return null;
      const n = Number(t);
      return isFinite(n) ? n : null;
    };
    const payload = {
      team_id: team.id,
      date: $('#gf-date').value,
      opponent: $('#gf-opp').value.trim(),
      home_away: $('#gf-ha').value,
      location: $('#gf-loc').value.trim() || null,
      game_time: $('#gf-time').value || null,
      result: $('#gf-result').value || '',
      our_score:   intOrNull($('#gf-our').value),
      their_score: intOrNull($('#gf-their').value),
    };
    const status = $('#gf-status');
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (gameId) {
        const { error } = await supabase.from('games').update(payload).eq('id', gameId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('games').insert(payload);
        if (error) throw error;
      }
      toast(gameId ? 'Game updated' : 'Game added');
      location.hash = '#/t/' + encodeURIComponent(team.slug) + '/schedule';
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
      btn.disabled = false; btn.textContent = gameId ? 'Save changes' : 'Add game';
    }
  });

  const del = $('#delete-game');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm(`Delete the ${existing.date} ${existing.opponent} game? Stats already entered for it will be removed too.`)) return;
      try {
        const { error } = await supabase.from('games').delete().eq('id', gameId);
        if (error) throw error;
        toast('Game deleted');
        location.hash = '#/t/' + encodeURIComponent(team.slug) + '/schedule';
      } catch (err) {
        toast('Delete failed: ' + (err.message || err), true);
      }
    });
  }
}

/* ================= CSV PARSING HELPERS ================= */
/** Tolerant line parser. Splits on comma OR tab. Trims fields. */
function parseRows(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.split(/[,\t]/).map(f => f.trim()));
}
/** Detects + strips a header row if the first row looks like field names. */
function stripHeader(rows, headerWords) {
  if (!rows.length) return rows;
  const first = rows[0].map(s => s.toLowerCase());
  const hits = first.filter(w => headerWords.includes(w)).length;
  return hits >= 1 ? rows.slice(1) : rows;
}
/** Parse a roster CSV. Each row: [jersey?, first, last?] OR [first, last?] OR [first only].
 *  Returns array of {jersey, first_name, last_name}. */
function parseRosterCSV(text) {
  let rows = parseRows(text);
  rows = stripHeader(rows, ['jersey','first','last','name','#','position']);
  return rows.map(r => {
    if (r.length === 1) {
      // "First Last" in one field — split by space
      const parts = r[0].split(/\s+/);
      return { jersey: null, first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
    }
    if (r.length === 2) {
      return { jersey: null, first_name: r[0], last_name: r[1] };
    }
    // 3+ columns: jersey, first, last (extra cols ignored)
    const looksLikeJersey = /^\d{1,3}$/.test(r[0]);
    if (looksLikeJersey) {
      return { jersey: r[0], first_name: r[1] || '', last_name: r[2] || '' };
    }
    // not a jersey number → treat as first,last,position-ish
    return { jersey: null, first_name: r[0], last_name: r[1] };
  }).filter(p => p.first_name);
}
/** Parse a date in any of: 2026-05-09 | 5/9 | 5/9/26 | 5/9/2026 → ISO yyyy-mm-dd */
function parseDate(s) {
  s = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (m) {
    let yr = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (yr < 100) yr += 2000;
    return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  return '';
}
/** Parse a schedule CSV. Each row: [date, opponent, home_away?, location?, time?].
 *  Returns array of {date, opponent, home_away, location, game_time}. */
function parseScheduleCSV(text) {
  let rows = parseRows(text);
  rows = stripHeader(rows, ['date','opponent','home','away','home/away','location','time']);
  return rows.map(r => {
    const date = parseDate(r[0]);
    const opp  = r[1] || '';
    const ha   = (r[2] || '').toLowerCase();
    const home_away = ha === 'away' || ha === '@' || ha === 'a' ? 'away' : 'home';
    const location  = r[3] || null;
    const game_time = r[4] && /^\d{1,2}:\d{2}/.test(r[4]) ? r[4] : null;
    return { date, opponent: opp, home_away, location, game_time };
  }).filter(g => g.date && g.opponent);
}

/* ================= VIEW: IMPORT ROSTER (coach-only) ================= */
async function renderPlayerImport(team, role) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Only coaches can import. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
    return;
  }
  $('#app').innerHTML = `
    <div class="card">
      <h1>Import roster</h1>
      <p class="muted small">
        Paste rows below, or pick a <code>.csv</code> / <code>.txt</code> file. Each row should be
        <code>jersey,first,last</code>. Any of these also work:
      </p>
      <pre class="muted small example">jersey,first,last
7,Emily,Chase
4,Marliey,Marte

Emily Chase
Marliey Marte

Emily,Chase
Marliey,Marte</pre>
      <form id="import-form" class="auth-form">
        <label for="ri-file">From file</label>
        <input id="ri-file" type="file" accept=".csv,.txt,text/csv,text/plain">
        <label for="ri-text">Or paste here</label>
        <textarea id="ri-text" rows="8" placeholder="One player per line..."></textarea>
        <button type="button" id="preview-btn" class="secondary">Preview</button>
        <div id="preview-area"></div>
        <button type="submit" class="primary" id="commit-btn" disabled>Import 0 players</button>
        <a href="#/t/${encodeURIComponent(team.slug)}/players" class="secondary">Cancel</a>
        <div id="ri-status" class="muted small"></div>
      </form>
    </div>`;

  const fileEl = $('#ri-file'), textEl = $('#ri-text'), previewArea = $('#preview-area');
  const commitBtn = $('#commit-btn');
  let parsed = [];

  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0]; if (!f) return;
    textEl.value = await f.text();
  });

  $('#preview-btn').addEventListener('click', () => {
    parsed = parseRosterCSV(textEl.value);
    if (!parsed.length) {
      previewArea.innerHTML = `<div class="muted small">Nothing parsed yet — check the format.</div>`;
      commitBtn.disabled = true;
      commitBtn.textContent = 'Import 0 players';
      return;
    }
    previewArea.innerHTML = `
      <ul class="row-list preview-list">
        ${parsed.map(p => `<li class="row-item">
          ${p.jersey ? `<span class="jersey">#${escapeHtml(p.jersey)}</span>` : '<span class="jersey muted">—</span>'}
          <span class="row-main">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</span>
        </li>`).join('')}
      </ul>`;
    commitBtn.disabled = false;
    commitBtn.textContent = `Import ${parsed.length} player${parsed.length === 1 ? '' : 's'}`;
  });

  $('#import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!parsed.length) return;
    const status = $('#ri-status');
    commitBtn.disabled = true; commitBtn.textContent = 'Importing…';
    try {
      const rows = parsed.map((p, i) => ({
        team_id: team.id,
        first_name: p.first_name,
        last_name: p.last_name || '',
        jersey: p.jersey || null,
        display_order: i,
      }));
      const { error } = await supabase.from('players').insert(rows);
      if (error) throw error;
      toast(`Imported ${rows.length} players`);
      location.hash = '#/t/' + encodeURIComponent(team.slug) + '/players';
    } catch (err) {
      console.error(err);
      status.textContent = err.message || String(err);
      status.classList.add('error');
      commitBtn.disabled = false; commitBtn.textContent = `Import ${parsed.length} players`;
    }
  });
}

/* ================= VIEW: IMPORT SCHEDULE (coach-only) ================= */
async function renderGameImport(team, role) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Only coaches can import. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
    return;
  }
  $('#app').innerHTML = `
    <div class="card">
      <h1>Import schedule</h1>
      <p class="muted small">
        Paste rows below, or pick a <code>.csv</code> / <code>.txt</code> file. Each row should be
        <code>date,opponent,home/away,location,time</code> (only date + opponent required).
      </p>
      <pre class="muted small example">date,opponent,home/away,location,time
2026-05-09,Westfield,home,Sadie Knox,12:00
5/11,Northampton,home
5/13,Southampton,away
5/16,Westfield,home</pre>
      <form id="import-form" class="auth-form">
        <label for="gi-file">From file</label>
        <input id="gi-file" type="file" accept=".csv,.txt,text/csv,text/plain">
        <label for="gi-text">Or paste here</label>
        <textarea id="gi-text" rows="8" placeholder="One game per line..."></textarea>
        <button type="button" id="preview-btn" class="secondary">Preview</button>
        <div id="preview-area"></div>
        <button type="submit" class="primary" id="commit-btn" disabled>Import 0 games</button>
        <a href="#/t/${encodeURIComponent(team.slug)}/schedule" class="secondary">Cancel</a>
        <div id="gi-status" class="muted small"></div>
      </form>
    </div>`;

  const fileEl = $('#gi-file'), textEl = $('#gi-text'), previewArea = $('#preview-area');
  const commitBtn = $('#commit-btn');
  let parsed = [];

  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0]; if (!f) return;
    textEl.value = await f.text();
  });

  $('#preview-btn').addEventListener('click', () => {
    parsed = parseScheduleCSV(textEl.value);
    if (!parsed.length) {
      previewArea.innerHTML = `<div class="muted small">Nothing parsed yet — check the format.</div>`;
      commitBtn.disabled = true;
      commitBtn.textContent = 'Import 0 games';
      return;
    }
    previewArea.innerHTML = `
      <ul class="row-list preview-list">
        ${parsed.map(g => `<li class="row-item">
          <span class="jersey">${escapeHtml(dateToMD(g.date))}</span>
          <span class="row-main">${escapeHtml(g.opponent)}</span>
          <span class="row-meta muted">${g.home_away === 'away' ? '@' : 'vs'}</span>
        </li>`).join('')}
      </ul>`;
    commitBtn.disabled = false;
    commitBtn.textContent = `Import ${parsed.length} game${parsed.length === 1 ? '' : 's'}`;
  });

  $('#import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!parsed.length) return;
    const status = $('#gi-status');
    commitBtn.disabled = true; commitBtn.textContent = 'Importing…';
    try {
      const rows = parsed.map(g => ({ team_id: team.id, ...g }));
      const { error } = await supabase.from('games').insert(rows);
      if (error) throw error;
      toast(`Imported ${rows.length} games`);
      location.hash = '#/t/' + encodeURIComponent(team.slug) + '/schedule';
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
      commitBtn.disabled = false; commitBtn.textContent = `Import ${parsed.length} games`;
    }
  });
}

/* ================= LINEUP CONSTANTS ================= */
const LINEUP_POSITIONS = ['P','C','1B','2B','3B','SS','LF','LC','CF','RC','RF','Bench'];
const NUM_INNINGS = 7;

/* ================= VIEW: LINEUP PICKER ================= */
async function renderLineupPicker(team, role) {
  const { data: games } = await supabase
    .from('games').select('id, date, opponent, home_away')
    .eq('team_id', team.id).order('date');
  const slugSafe = encodeURIComponent(team.slug);
  if (!games || !games.length) {
    $('#app').innerHTML = `<div class="card"><h1>Pick a game</h1>
      <p class="muted">No games on the schedule yet. <a href="#/t/${slugSafe}/game/new">Add one</a>.</p></div>`;
    return;
  }
  const items = games.map(g => `
    <a href="#/t/${slugSafe}/lineup/${encodeURIComponent(g.id)}" class="lineup-game-pick">
      <span><strong>${escapeHtml(dateToMD(g.date))}</strong> &nbsp;
        ${g.home_away === 'away' ? '@' : 'vs'} ${escapeHtml(g.opponent || '')}</span>
    </a>`).join('');
  $('#app').innerHTML = `
    <div class="section-title">Pick a game</div>
    ${items}`;
}

/* ================= VIEW: LINEUP BUILDER ================= */
async function renderLineupBuilder(team, role, gameId) {
  const writer = isWriter(role);
  const slugSafe = encodeURIComponent(team.slug);

  const [{ data: game }, { data: players }, { data: lineup }] = await Promise.all([
    supabase.from('games').select('id, date, opponent, home_away')
      .eq('id', gameId).eq('team_id', team.id).maybeSingle(),
    supabase.from('players').select('id, first_name, last_name, jersey, display_order')
      .eq('team_id', team.id)
      .order('display_order', { ascending: true }).order('jersey', { ascending: true }),
    supabase.from('lineups').select('*').eq('game_id', gameId).maybeSingle(),
  ]);
  if (!game) {
    $('#app').innerHTML = `<div class="card error">Game not found. <a href="#/t/${slugSafe}/lineup">Back</a></div>`;
    return;
  }
  const playerById = {};
  (players || []).forEach(p => { playerById[p.id] = p; });

  // Existing batting order (UUIDs) + positions (object). Append any roster
  // players not already in the order so all girls always appear.
  const savedOrder = Array.isArray(lineup?.batting_order) ? lineup.batting_order : [];
  const orderSet = new Set(savedOrder);
  const ordered = [...savedOrder, ...players.filter(p => !orderSet.has(p.id)).map(p => p.id)];
  const positions = (lineup?.positions && typeof lineup.positions === 'object') ? lineup.positions : {};

  const innArr = (val) => {
    if (Array.isArray(val)) {
      const a = val.slice(0, NUM_INNINGS);
      while (a.length < NUM_INNINGS) a.push('');
      return a;
    }
    return new Array(NUM_INNINGS).fill('');
  };
  const inningOptions = (selected, inning) => {
    let html = `<option value="">I${inning}</option>`;
    LINEUP_POSITIONS.forEach(p => {
      html += `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`;
    });
    return html;
  };

  const headerCells = Array.from({length: NUM_INNINGS}, (_, n) => `<span>I${n+1}</span>`).join('');
  const ro = writer ? '' : 'lineup-readonly';

  const rowHtml = (pid, i) => {
    const p = playerById[pid];
    if (!p) return '';
    const arr = innArr(positions[pid]);
    const innings = arr.map((pos, idx) => `
      <select class="pos-select inn-pos" data-inning="${idx + 1}" ${writer ? '' : 'disabled'}>
        ${inningOptions(pos, idx + 1)}
      </select>`).join('');
    return `
      <li class="lineup-row" data-pid="${escapeHtml(pid)}">
        <span class="drag-handle" aria-label="Drag to reorder">⋮⋮</span>
        <span class="bat-num">${i + 1}</span>
        <span class="player-name" title="${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}">${escapeHtml(p.first_name)}</span>
        ${innings}
      </li>`;
  };

  $('#app').innerHTML = `
    <div class="lineup-header">
      <div>${escapeHtml(dateToMD(game.date))} ${game.home_away === 'away' ? '@' : 'vs'} ${escapeHtml(game.opponent || '')}</div>
      ${writer ? `<button class="copy-btn" data-action="copy-last-lineup">Copy last game</button>` : ''}
    </div>
    ${lineup?.updated_at ? `<div class="lineup-meta">Last saved ${escapeHtml((lineup.updated_at || '').slice(0,16).replace('T',' '))}</div>` : ''}
    <div class="lineup-grid-header">
      <span></span><span>#</span><span>Player</span>${headerCells}
    </div>
    <ul id="lineup-list" class="lineup-list ${ro}">
      ${ordered.map((pid, i) => rowHtml(pid, i)).join('')}
    </ul>
    ${writer
      ? `<button class="save-lineup-btn" data-action="save-lineup" data-game="${escapeHtml(gameId)}">Save lineup</button>`
      : `<div class="empty">Read-only — only the coach can edit the lineup.</div>`}
  `;

  if (writer && typeof Sortable !== 'undefined') {
    Sortable.create(document.getElementById('lineup-list'), {
      handle: '.drag-handle',
      animation: 150,
      onSort: () => {
        document.querySelectorAll('.lineup-row').forEach((li, i) => {
          li.querySelector('.bat-num').textContent = i + 1;
        });
      },
    });
  }
}

async function saveLineupFromUI(gameId) {
  const order = [];
  const positions = {};
  document.querySelectorAll('.lineup-row').forEach(li => {
    const pid = li.dataset.pid;
    order.push(pid);
    const arr = Array.from(li.querySelectorAll('.inn-pos')).map(s => s.value || '');
    if (arr.some(v => v)) positions[pid] = arr;
  });
  const btn = document.querySelector('.save-lineup-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    // Need the team_id for the upsert
    const { data: g } = await supabase.from('games').select('team_id').eq('id', gameId).single();
    if (!g) throw new Error('Game not found');
    const { error } = await supabase.from('lineups').upsert({
      game_id: gameId,
      team_id: g.team_id,
      batting_order: order,
      positions,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'game_id' });
    if (error) throw error;
    toast('Lineup saved');
  } catch (err) {
    console.error(err);
    toast('Save failed: ' + (err.message || err), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save lineup'; }
  }
}

async function copyLastLineup() {
  // Fetch most-recently-updated lineup for THIS team
  const list = document.getElementById('lineup-list');
  if (!list) return;
  // We need team context — extract from the first save button's hash route or current URL
  const m = location.hash.match(/^#\/t\/([^/]+)\/lineup\/([^/]+)/);
  if (!m) return;
  const slug = decodeURIComponent(m[1]);
  const team = await loadTeamBySlug(slug);
  if (!team) return;
  const { data: rows } = await supabase
    .from('lineups').select('batting_order, positions, updated_at, game_id')
    .eq('team_id', team.id).order('updated_at', { ascending: false }).limit(1);
  const latest = rows && rows[0];
  if (!latest) { toast('No saved lineups yet.'); return; }
  // Apply to DOM
  const order = Array.isArray(latest.batting_order) ? latest.batting_order : [];
  const positions = (latest.positions && typeof latest.positions === 'object') ? latest.positions : {};
  const rowsByPid = {};
  list.querySelectorAll('.lineup-row').forEach(li => { rowsByPid[li.dataset.pid] = li; });
  const allPids = Array.from(list.querySelectorAll('.lineup-row')).map(li => li.dataset.pid);
  const merged = [...order, ...allPids.filter(p => !order.includes(p))];
  list.innerHTML = '';
  merged.forEach((pid, i) => {
    const li = rowsByPid[pid]; if (!li) return;
    list.appendChild(li);
    li.querySelector('.bat-num').textContent = i + 1;
    const arr = Array.isArray(positions[pid]) ? positions[pid] : [];
    const selects = li.querySelectorAll('.inn-pos');
    for (let k = 0; k < selects.length; k++) selects[k].value = arr[k] || '';
  });
  toast('Copied — Save to commit.');
}

/* ================= VIEW: TEAM SETTINGS ================= */
async function renderSettings(team, role) {
  if (!isWriter(role)) {
    $('#app').innerHTML = `<div class="card error">Coaches only. <a href="#/t/${encodeURIComponent(team.slug)}">Back</a></div>`;
    return;
  }
  const slugSafe = encodeURIComponent(team.slug);
  const v = (s) => escapeHtml(s || '');

  $('#app').innerHTML = `
    <div class="card">
      <h1>Team settings</h1>
      <form id="settings-form" class="auth-form">
        <label for="s-name">Team name</label>
        <input id="s-name" type="text" required maxlength="80" value="${v(team.name)}">

        <label for="s-season">Season</label>
        <input id="s-season" type="text" maxlength="40" value="${v(team.season)}" placeholder="e.g. 2026 Spring">

        <div class="color-row">
          <div><label for="s-pcolor">Primary color</label>
            <input id="s-pcolor" type="color" value="${v(team.primary_color || '#1f3864')}"></div>
          <div><label for="s-acolor">Accent color</label>
            <input id="s-acolor" type="color" value="${v(team.accent_color || '#c9a227')}"></div>
        </div>

        <label>Public visibility</label>
        <label class="check-row">
          <input id="s-public" type="checkbox" ${team.is_public ? 'checked' : ''}>
          <span>Anyone with the link can view (recommended). Uncheck to require sign-in.</span>
        </label>

        <hr class="muted-divider">

        <label>Team logo (left side of top bar)</label>
        <div class="photo-row">
          ${team.logo_url
            ? `<img id="team-logo-preview" class="topbar-logo preview" src="${v(team.logo_url)}" alt="">`
            : `<div id="team-logo-preview" class="topbar-logo preview placeholder">🏟️</div>`}
          <div class="photo-actions">
            <input id="s-logo" type="file" accept="image/*">
            ${team.logo_url ? '<button type="button" id="clear-logo" class="secondary small">Remove</button>' : ''}
          </div>
        </div>
        <div id="logo-status" class="muted small"></div>

        <label>League logo (right side of top bar)</label>
        <div class="photo-row">
          ${team.league_logo_url
            ? `<img id="league-logo-preview" class="topbar-logo preview" src="${v(team.league_logo_url)}" alt="">`
            : `<div id="league-logo-preview" class="topbar-logo preview placeholder">🏆</div>`}
          <div class="photo-actions">
            <input id="s-league" type="file" accept="image/*">
            ${team.league_logo_url ? '<button type="button" id="clear-league" class="secondary small">Remove</button>' : ''}
          </div>
        </div>
        <div id="league-status" class="muted small"></div>

        <label for="s-league-url">League logo link (optional)</label>
        <input id="s-league-url" type="url" maxlength="500" value="${v(team.league_url)}" placeholder="https://www.westfieldlittleleague.com/...">
        <p class="muted small">When set, tapping the league logo opens this URL in a new tab.</p>

        <button type="submit" class="primary">Save settings</button>
        <a href="#/t/${slugSafe}" class="secondary">Cancel</a>
        <div id="settings-status" class="muted small"></div>
      </form>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Share with parents</h2>
      <p class="muted small">Parents don't need an account to view the team. Just send them this link:</p>
      <div class="invite-row">
        <input id="share-url" type="text" readonly value="${escapeHtml(window.location.origin + '/#/t/' + team.slug)}">
        <button type="button" id="copy-share" class="secondary">Copy</button>
      </div>
      <div id="share-status" class="muted small"></div>

      <hr class="muted-divider">

      <h3 style="margin:8px 0 4px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Optional: invite as a member</h3>
      <p class="muted small">For parents who want to be tracked on the team (future features like notifications), share this invite link instead — they'll sign in with their email and be added as a parent.</p>
      <div class="invite-row">
        <input id="invite-url" type="text" readonly value="${escapeHtml(window.location.origin + '/#/join/' + team.slug)}">
        <button type="button" id="copy-invite" class="secondary">Copy</button>
      </div>
      <div id="invite-status" class="muted small"></div>
    </div>`;

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name:          $('#s-name').value.trim(),
      season:        $('#s-season').value.trim() || null,
      primary_color: $('#s-pcolor').value,
      accent_color:  $('#s-acolor').value,
      is_public:     $('#s-public').checked,
      league_url:    $('#s-league-url').value.trim() || null,
    };
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { error } = await supabase.from('teams').update(payload).eq('id', team.id);
      if (error) throw error;
      toast('Settings saved');
      location.hash = '#/t/' + slugSafe;
    } catch (err) {
      $('#settings-status').textContent = err.message || String(err);
      $('#settings-status').classList.add('error');
      btn.disabled = false; btn.textContent = 'Save settings';
    }
  });

  const wireLogoUpload = (inputId, statusId, previewId, clearBtnId, kind) => {
    const colName = kind === 'team' ? 'logo_url' : 'league_logo_url';
    const pathBase = kind === 'team' ? `team-logos/${team.id}/main.jpg` : `team-logos/${team.id}/league.jpg`;
    const inp = document.getElementById(inputId);
    const status = document.getElementById(statusId);
    const preview = document.getElementById(previewId);
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      status.textContent = 'Uploading…'; status.classList.remove('error');
      try {
        const url = await uploadImageToLogos(pathBase, f);
        const upd = await supabase.from('teams').update({ [colName]: url }).eq('id', team.id);
        if (upd.error) throw upd.error;
        if (preview.tagName === 'IMG') preview.src = url;
        else preview.outerHTML = `<img id="${previewId}" class="topbar-logo preview" src="${url}" alt="">`;
        status.textContent = 'Saved.';
        applyTheme({ ...team, [colName]: url });
      } catch (err) {
        console.error(err);
        status.textContent = 'Upload failed: ' + (err.message || err);
        status.classList.add('error');
      }
    });
    const clearBtn = document.getElementById(clearBtnId);
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      if (!confirm('Remove this logo?')) return;
      try {
        await supabase.storage.from('logos').remove([pathBase]);
        const upd = await supabase.from('teams').update({ [colName]: null }).eq('id', team.id);
        if (upd.error) throw upd.error;
        const newPreview = document.createElement('div');
        newPreview.id = previewId; newPreview.className = 'topbar-logo preview placeholder';
        newPreview.textContent = kind === 'team' ? '🏟️' : '🏆';
        document.getElementById(previewId).replaceWith(newPreview);
        clearBtn.remove();
        status.textContent = 'Removed.';
        applyTheme({ ...team, [colName]: null });
      } catch (err) {
        status.textContent = 'Remove failed: ' + (err.message || err);
        status.classList.add('error');
      }
    });
  };
  wireLogoUpload('s-logo',   'logo-status',   'team-logo-preview',   'clear-logo',   'team');
  wireLogoUpload('s-league', 'league-status', 'league-logo-preview', 'clear-league', 'league');

  const wireCopy = (btnId, urlId, statusId) => {
    const btn = $('#' + btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const url = $('#' + urlId).value;
      try {
        await navigator.clipboard.writeText(url);
        $('#' + statusId).textContent = 'Link copied to clipboard.';
      } catch {
        $('#' + urlId).select();
        $('#' + statusId).textContent = 'Tap and hold the field, then choose Copy.';
      }
    });
  };
  wireCopy('copy-share',  'share-url',  'share-status');
  wireCopy('copy-invite', 'invite-url', 'invite-status');
}

/* ================= VIEW: JOIN TEAM (invite link landing) ================= */
async function renderJoinTeam(slug, session) {
  hideTeamNav();
  applyTheme(null);
  if (!slug) {
    $('#app').innerHTML = `<div class="card error">Invalid invite link.</div>`;
    return;
  }
  const team = await loadTeamBySlug(slug);
  if (!team) {
    $('#app').innerHTML = `<div class="card error">Team not found: <code>${escapeHtml(slug)}</code>.</div>`;
    return;
  }
  applyTheme(team);

  if (!session) {
    // Show sign-in form, then bring them back to this URL after auth
    $('#app').innerHTML = `
      <div class="card">
        <h1>Join ${escapeHtml(team.name)}</h1>
        <p>Sign in with your email to be added to the team as a parent. You'll get game updates, the schedule, and the roster.</p>
        <form id="signin-form" class="auth-form">
          <label for="email">Email</label>
          <input id="email" type="email" required autocomplete="email" placeholder="you@example.com">
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
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: window.location.origin + '/#/join/' + encodeURIComponent(slug),
          },
        });
        if (error) throw error;
        status.innerHTML = `Check <strong>${escapeHtml(email)}</strong> for a sign-in link. Once you click it you'll be added to <strong>${escapeHtml(team.name)}</strong> automatically.`;
        btn.style.display = 'none';
      } catch (err) {
        status.textContent = 'Error: ' + (err.message || err);
        status.classList.add('error');
        btn.disabled = false; btn.textContent = 'Send sign-in link';
      }
    });
    return;
  }

  // Signed in — try to add as parent
  $('#app').innerHTML = `<div class="card"><h1>Joining ${escapeHtml(team.name)}…</h1></div>`;
  // Check if already a member
  const { data: existing } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', team.id).eq('user_id', session.user.id).maybeSingle();
  if (existing) {
    toast(`You're already on this team (${existing.role}).`);
    location.hash = '#/t/' + encodeURIComponent(slug);
    return;
  }
  const { error } = await supabase
    .from('team_members')
    .insert({ team_id: team.id, user_id: session.user.id, role: 'parent' });
  if (error) {
    $('#app').innerHTML = `<div class="card error">
      Couldn't add you to the team: ${escapeHtml(error.message || String(error))}
      <p><a href="#/t/${encodeURIComponent(slug)}" class="secondary">View team anyway</a></p>
    </div>`;
    return;
  }
  toast(`Welcome to ${team.name}!`);
  location.hash = '#/t/' + encodeURIComponent(slug);
}

/* ================= VIEW: NOT FOUND ================= */
function renderNotFound() {
  $('#app').innerHTML = `<div class="card"><h1>Not found</h1><a href="#/" class="secondary">Go home</a></div>`;
}

/* ================= INIT ================= */
// Document-level click dispatcher for data-action elements (used by lineup builder)
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  if (action === 'save-lineup')      saveLineupFromUI(t.dataset.game);
  else if (action === 'copy-last-lineup') copyLastLineup();
});

supabase.auth.onAuthStateChange(() => { route(); });
window.addEventListener('hashchange', () => { route(); });

route().catch((err) => {
  $('#app').innerHTML = `<div class="card error">Boot failed: ${escapeHtml(err.message || err)}</div>`;
  console.error(err);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
