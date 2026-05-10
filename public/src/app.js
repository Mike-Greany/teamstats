// TeamStats — entry point.
// Phase 2 deliverable: confirm Supabase client connects from a static page.
// Subsequent phases add auth, team CRUD, and the ported PWA views.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const $ = (sel) => document.querySelector(sel);

async function bootstrap() {
  // Ping the database with a query that any anon user is allowed to make:
  // count public teams. (RLS allows anon to SELECT teams where is_public=true.)
  let dbStatus = 'unknown';
  try {
    const { count, error } = await supabase
      .from('teams').select('id', { count: 'exact', head: true });
    if (error) throw error;
    dbStatus = `connected (${count ?? 0} public team${count === 1 ? '' : 's'})`;
  } catch (err) {
    dbStatus = `error — ${err.message || err}`;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const authStatus = session
    ? `signed in as ${session.user.email}`
    : 'not signed in (anon)';

  $('#app').innerHTML = `
    <div class="card">
      <h1>TeamStats — Phase 2</h1>
      <p>Frontend skeleton is live and talking to Supabase.</p>
      <ul>
        <li><strong>DB:</strong> ${dbStatus}</li>
        <li><strong>Auth:</strong> ${authStatus}</li>
      </ul>
      <p class="muted">
        Next up: auth flows (Phase 3), team-creation wizard (Phase 4), and porting
        the existing Teddy 10U views into a multi-tenant model.
      </p>
    </div>`;
}

bootstrap().catch((err) => {
  $('#app').innerHTML = `<div class="card error">Boot failed: ${err.message || err}</div>`;
  console.error(err);
});

// Register the service worker (offline cache for static assets only in v1)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
