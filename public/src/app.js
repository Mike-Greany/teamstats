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
}
function setBrand(text) { const b = $('.brand'); if (b) b.textContent = text; }
function showTeamNav(team, role, activeTab) {
  const nav = $('#bottomnav');
  nav.hidden = false;
  const slugSafe = encodeURIComponent(team.slug);
  const map = {
    team:     `#/t/${slugSafe}`,
    schedule: `#/t/${slugSafe}/schedule`,
    players:  `#/t/${slugSafe}/players`,
    log:      `#/t/${slugSafe}/log`,
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
}
function fmtAvg(x) {
  if (!isFinite(x) || x == null) return '.000';
  if (x >= 1) return x.toFixed(3);
  return x.toFixed(3).replace(/^0\./, '.');
}

/* ================= BR-SHORTHAND PARSER (port from Apps Script) ================= */
const ALIASES = {
  'BB':'BB','HBP':'HBP','R':'R','RBI':'RBI','SB':'SB','S':'SB',
  '1B':'1B','2B':'2B','3B':'3B','HR':'HR',
  'RUN':'R','RUNS':'R','WALK':'BB','WALKS':'BB'
};
function parseNote(text) {
  const empty = {AB:0,H:0,'1B':0,'2B':0,'3B':0,HR:0,BB:0,HBP:0,R:0,RBI:0,SB:0};
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
    .select('id, slug, name, primary_color, accent_color, season, logo_url, league_logo_url, is_public')
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
  const role = session ? await loadMyRole(team.id, session.user.id) : null;

  const sub = args[1];
  const id  = args[2];

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
  if (sub === 'player' && id)           { showTeamNav(team, role, 'players'); return renderPlayerForm(team, role, id); }
  if (sub === 'players' && id === 'import') { showTeamNav(team, role, 'players'); return renderPlayerImport(team, role); }
  if (sub === 'game'   && id === 'new') { showTeamNav(team, role, 'schedule'); return renderGameForm(team, role, null); }
  if (sub === 'game'   && id)           { showTeamNav(team, role, 'schedule'); return renderGameForm(team, role, id); }
  if (sub === 'games' && id === 'import'){ showTeamNav(team, role, 'schedule'); return renderGameImport(team, role); }

  renderNotFound();
}

/* ================= VIEW: SIGN IN ================= */
function renderSignIn() {
  hideTeamNav();
  applyTheme(null);
  $('#app').innerHTML = `
    <div class="card">
      <h1>Welcome to TeamStats</h1>
      <p>Enter your email — we'll send you a one-click sign-in link. No password to remember.</p>
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

/* ================= VIEW: TEAM BATTING (default tab) ================= */
async function renderTeamBatting(team, role, session) {
  // Pull players + game_log joined, aggregate client-side
  const [{ data: players }, { data: logs }] = await Promise.all([
    supabase.from('players').select('id, first_name, last_name, jersey').eq('team_id', team.id),
    supabase.from('game_log').select('player_id, ab, r, h, b1, b2, b3, hr, bb, hbp, rbi, sb, game_id').eq('team_id', team.id),
  ]);
  const playerMap = {};
  (players || []).forEach(p => {
    playerMap[p.id] = { id: p.id, first: p.first_name, last: p.last_name || '', jersey: p.jersey,
      G:0, AB:0, R:0, H:0, '1B':0, '2B':0, '3B':0, HR:0, BB:0, HBP:0, RBI:0, SB:0 };
  });
  (logs || []).forEach(r => {
    const p = playerMap[r.player_id]; if (!p) return;
    p.G++; p.AB += r.ab||0; p.R += r.r||0; p.H += r.h||0;
    p['1B'] += r.b1||0; p['2B'] += r.b2||0; p['3B'] += r.b3||0; p.HR += r.hr||0;
    p.BB += r.bb||0; p.HBP += r.hbp||0; p.RBI += r.rbi||0; p.SB += r.sb||0;
  });
  const lines = Object.values(playerMap).map(p => {
    p.AVG = p.AB > 0 ? p.H / p.AB : 0;
    const denom = p.AB + p.BB + p.HBP;
    p.OBP = denom > 0 ? (p.H + p.BB + p.HBP) / denom : 0;
    return p;
  }).sort((a,b) => (b.AVG - a.AVG) || (b.H - a.H) || (b.AB - a.AB));

  const team_ = { G: new Set((logs||[]).map(r => r.game_id)).size,
    AB:0,R:0,H:0,'1B':0,'2B':0,'3B':0,HR:0,BB:0,HBP:0,RBI:0,SB:0 };
  (logs||[]).forEach(r => {
    team_.AB+=r.ab||0; team_.R+=r.r||0; team_.H+=r.h||0;
    team_['1B']+=r.b1||0; team_['2B']+=r.b2||0; team_['3B']+=r.b3||0; team_.HR+=r.hr||0;
    team_.BB+=r.bb||0; team_.HBP+=r.hbp||0; team_.RBI+=r.rbi||0; team_.SB+=r.sb||0;
  });
  team_.AVG = team_.AB > 0 ? team_.H / team_.AB : 0;
  const d = team_.AB + team_.BB + team_.HBP;
  team_.OBP = d > 0 ? (team_.H + team_.BB + team_.HBP) / d : 0;

  const head = `<tr><th class="name">Player</th><th>G</th><th>AB</th><th>R</th><th>H</th><th>1B</th><th>2B</th><th>HR</th><th>BB</th><th>HBP</th><th>RBI</th><th>SB</th><th>AVG</th><th>OBP</th></tr>`;
  const body = lines.map(p => `
    <tr>
      <td class="name">${escapeHtml(p.first)} ${escapeHtml(p.last)}</td>
      <td>${p.G}</td><td>${p.AB}</td><td>${p.R}</td><td>${p.H}</td>
      <td>${p['1B']}</td><td>${p['2B']}</td><td>${p.HR}</td>
      <td>${p.BB}</td><td>${p.HBP}</td><td>${p.RBI}</td><td>${p.SB}</td>
      <td>${fmtAvg(p.AVG)}</td><td>${fmtAvg(p.OBP)}</td>
    </tr>`).join('');
  const totals = `
    <tr class="totals">
      <td class="name">Team Totals</td>
      <td>${team_.G}</td><td>${team_.AB}</td><td>${team_.R}</td><td>${team_.H}</td>
      <td>${team_['1B']}</td><td>${team_['2B']}</td><td>${team_.HR}</td>
      <td>${team_.BB}</td><td>${team_.HBP}</td><td>${team_.RBI}</td><td>${team_.SB}</td>
      <td>${fmtAvg(team_.AVG)}</td><td>${fmtAvg(team_.OBP)}</td>
    </tr>`;
  const empty = !lines.length ? `<p class="muted small">No roster yet. Tap Players to add some.</p>` : '';

  $('#app').innerHTML = `
    <div class="section-title">Standard Batting</div>
    ${empty}
    ${lines.length ? `<div class="table-wrap"><table class="stats"><thead>${head}</thead><tbody>${body}${totals}</tbody></table></div>` : ''}
    ${session ? `<div class="card"><button id="signout-btn" class="secondary">Sign out</button></div>` : ''}`;
  const so = $('#signout-btn');
  if (so) so.addEventListener('click', async () => { await supabase.auth.signOut(); });
}

/* ================= VIEW: SCHEDULE TAB ================= */
async function renderTeamSchedule(team, role, session) {
  const writer = isWriter(role);
  const { data: games } = await supabase
    .from('games').select('id, date, opponent, home_away, location')
    .eq('team_id', team.id).order('date', { ascending: true });
  const rows = (games || []).map(g => `
    <li class="row-item">
      <span class="jersey">${escapeHtml(dateToMD(g.date))}</span>
      <span class="row-main">${escapeHtml(g.opponent || '')}</span>
      <span class="row-meta muted">${g.home_away === 'away' ? '@' : 'vs'}</span>
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
    .from('players').select('id, first_name, last_name, jersey, position, display_order')
    .eq('team_id', team.id).order('display_order', { ascending: true }).order('jersey', { ascending: true });
  const rows = (players || []).map(p => `
    <li class="row-item">
      ${p.jersey ? `<span class="jersey">#${escapeHtml(p.jersey)}</span>` : '<span class="jersey muted">—</span>'}
      <span class="row-main">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</span>
      ${p.position ? `<span class="row-meta muted">${escapeHtml(p.position)}</span>` : ''}
      ${writer ? `<a href="#/t/${encodeURIComponent(team.slug)}/player/${encodeURIComponent(p.id)}" class="edit-btn">✎</a>` : ''}
    </li>`).join('');
  const empty = !players?.length ? `<p class="muted small">No players yet${writer ? ' — tap + Add to add one.' : '.'}</p>` : '';
  $('#app').innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Roster</h2>
        ${writer ? `
          <span class="add-group">
            <a href="#/t/${encodeURIComponent(team.slug)}/player/new" class="add-btn">+ Add</a>
            <a href="#/t/${encodeURIComponent(team.slug)}/players/import" class="add-btn ghost">Import</a>
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

  $('#app').innerHTML = `
    <div class="card">
      <h1>${existing ? 'Edit stats' : 'Add stats'}</h1>
      <form id="entry-form" class="auth-form">
        <label for="ef-game">Game</label>
        <select id="ef-game" required ${existing ? 'disabled' : ''}>${gameOpts}</select>
        <label for="ef-player">Player</label>
        <select id="ef-player" required ${existing ? 'disabled' : ''}>${playerOpts}</select>

        <label>Mode</label>
        <div class="mode-toggle" role="tablist">
          <button type="button" class="${initMode === 'quick' ? 'active' : ''}" data-mode="quick">Quick note</button>
          <button type="button" class="${initMode === 'manual' ? 'active' : ''}" data-mode="manual">Manual fields</button>
        </div>

        <div id="quick-mode" ${initMode === 'manual' ? 'hidden' : ''}>
          <label for="ef-note">BR shorthand</label>
          <textarea id="ef-note" rows="3" placeholder="e.g. 1-3, BB, 2SB, R, RBI">${escapeHtml(existing ? (existing.notes || '') : '')}</textarea>
          <label>Live preview</label>
          <div class="preview-pills" id="preview"><span class="muted small">—</span></div>
        </div>

        <div id="manual-mode" ${initMode === 'quick' ? 'hidden' : ''}>
          <div class="manual-grid">
            ${[['ab','AB'],['r','R'],['h','H'],['b1','1B'],['b2','2B'],['hr','HR'],['bb','BB'],['hbp','HBP'],['rbi','RBI'],['sb','SB']]
              .map(([k,l]) => `<div><label>${l}</label><input type="number" min="0" value="${v(k)}" data-mk="${k}"></div>`).join('')}
          </div>
          <label for="ef-manual-notes">Notes</label>
          <input id="ef-manual-notes" type="text" maxlength="300" value="${escapeHtml(existing ? (existing.notes || '') : '')}" placeholder="optional">
        </div>

        <button type="submit" class="primary">${existing ? 'Save changes' : 'Save row'}</button>
        ${existing ? '<button type="button" id="delete-entry" class="danger">Delete this entry</button>' : ''}
        <a href="#/t/${encodeURIComponent(team.slug)}/log" class="secondary">Cancel</a>
        <div id="ef-status" class="muted small"></div>
      </form>
    </div>`;

  let mode = initMode;
  const noteEl = $('#ef-note');
  const updatePreview = () => {
    const { stats } = parseNote(noteEl.value);
    const pills = ['AB','R','H','1B','2B','HR','BB','HBP','RBI','SB']
      .filter(k => stats[k]).map(k => `<span class="pill">${k} ${stats[k]}</span>`).join('');
    $('#preview').innerHTML = pills || '<span class="muted small">—</span>';
  };
  noteEl.addEventListener('input', updatePreview);
  if (mode === 'quick') updatePreview();

  $$('.mode-toggle button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('.mode-toggle button').forEach(x => x.classList.toggle('active', x === b));
    $('#quick-mode').hidden = mode !== 'quick';
    $('#manual-mode').hidden = mode !== 'manual';
  }));

  $('#entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const gameId = (existing ? existing.game_id : $('#ef-game').value);
    const playerId = (existing ? existing.player_id : $('#ef-player').value);
    let row;
    if (mode === 'quick') {
      const note = noteEl.value;
      const { stats } = parseNote(note);
      row = { team_id: team.id, game_id: gameId, player_id: playerId,
        ab: stats.AB, r: stats.R, h: stats.H,
        b1: stats['1B'], b2: stats['2B'], b3: stats['3B'], hr: stats.HR,
        bb: stats.BB, hbp: stats.HBP, rbi: stats.RBI, sb: stats.SB,
        notes: note };
    } else {
      const m = {};
      $$('input[data-mk]').forEach(i => m[i.dataset.mk] = parseInt(i.value, 10) || 0);
      row = { team_id: team.id, game_id: gameId, player_id: playerId,
        ab: m.ab, r: m.r, h: m.h, b1: m.b1, b2: m.b2, b3: 0, hr: m.hr,
        bb: m.bb, hbp: m.hbp, rbi: m.rbi, sb: m.sb,
        notes: $('#ef-manual-notes').value || null };
    }
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
        <a href="#/t/${encodeURIComponent(team.slug)}" class="secondary">Cancel</a>
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
      location.hash = '#/t/' + encodeURIComponent(team.slug);
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
        location.hash = '#/t/' + encodeURIComponent(team.slug);
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
  let existing = { date: '', opponent: '', home_away: 'home', location: '', game_time: '' };
  if (gameId) {
    const { data, error } = await supabase
      .from('games').select('id, date, opponent, home_away, location, game_time')
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
        <button type="submit" class="primary">${gameId ? 'Save changes' : 'Add game'}</button>
        ${gameId ? '<button type="button" id="delete-game" class="danger">Delete this game</button>' : ''}
        <a href="#/t/${encodeURIComponent(team.slug)}" class="secondary">Cancel</a>
        <div id="gf-status" class="muted small"></div>
      </form>
    </div>`;

  $('#game-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      team_id: team.id,
      date: $('#gf-date').value,
      opponent: $('#gf-opp').value.trim(),
      home_away: $('#gf-ha').value,
      location: $('#gf-loc').value.trim() || null,
      game_time: $('#gf-time').value || null,
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
      location.hash = '#/t/' + encodeURIComponent(team.slug);
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
        location.hash = '#/t/' + encodeURIComponent(team.slug);
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
        <a href="#/t/${encodeURIComponent(team.slug)}" class="secondary">Cancel</a>
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
      location.hash = '#/t/' + encodeURIComponent(team.slug);
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
        <a href="#/t/${encodeURIComponent(team.slug)}" class="secondary">Cancel</a>
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
      location.hash = '#/t/' + encodeURIComponent(team.slug);
    } catch (err) {
      status.textContent = err.message || String(err);
      status.classList.add('error');
      commitBtn.disabled = false; commitBtn.textContent = `Import ${parsed.length} games`;
    }
  });
}

/* ================= VIEW: NOT FOUND ================= */
function renderNotFound() {
  $('#app').innerHTML = `<div class="card"><h1>Not found</h1><a href="#/" class="secondary">Go home</a></div>`;
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
