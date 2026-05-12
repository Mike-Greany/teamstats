// TeamStats — entry point.
// Phase 3: email magic-link auth. Signed-out users see a sign-in form;
// signed-in users see a confirmation card. Future phases will replace the
// signed-in view with the team picker / onboarding wizard.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,   // auto-handle the magic-link token in the URL hash
  },
});

const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ================= RENDER ================= */
async function render() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) renderSignedIn(session);
  else         renderSignIn();
}

function renderSignIn() {
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
    status.textContent = '';
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

function renderSignedIn(session) {
  $('#app').innerHTML = `
    <div class="card">
      <h1>You're in</h1>
      <p>Signed in as <strong>${escapeHtml(session.user.email)}</strong>.</p>
      <p class="muted">
        Next up (Phase 4): create your first team — name, colors, logo, roster, schedule.
        Then Phase 5+ ports the Teddy 10U views into the multi-tenant model.
      </p>
      <button id="signout-btn" class="secondary">Sign out</button>
    </div>`;

  $('#signout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });
}

/* ================= INIT ================= */
// Re-render whenever auth state changes (sign-in, sign-out, token refresh, etc.)
supabase.auth.onAuthStateChange(() => { render(); });

render().catch((err) => {
  $('#app').innerHTML = `<div class="card error">Boot failed: ${escapeHtml(err.message || err)}</div>`;
  console.error(err);
});

// Register the service worker (offline cache for static assets only in v1)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
