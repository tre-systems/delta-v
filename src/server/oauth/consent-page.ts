import type { StoredAuthorizationRequest } from './model';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const renderOAuthConsentPage = (opts: {
  request: StoredAuthorizationRequest;
  requestToken: string;
  username?: string;
  error?: string;
}): string => {
  const redirectHost = new URL(opts.request.redirectUri).host;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07101f">
  <title>Authorize ${escapeHtml(opts.request.clientName)} — Delta-V</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; --bg:#040b16; --panel:#0b1729; --border:#29405f; --text:#eef5ff; --muted:#a7b5ca; --accent:#7ad7ff; --danger:#ff9c9c; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:1rem; color:var(--text); background:radial-gradient(circle at top, #102945, var(--bg) 48%); }
    main { width:min(100%, 520px); padding:clamp(1.25rem, 5vw, 2rem); border:1px solid var(--border); border-radius:18px; background:rgba(11,23,41,.96); box-shadow:0 24px 70px rgba(0,0,0,.4); }
    .brand { color:var(--accent); font-size:.76rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; }
    h1 { margin:.55rem 0 .7rem; font-size:clamp(1.7rem, 7vw, 2.4rem); line-height:1.12; }
    p { color:var(--muted); line-height:1.6; }
    .client { margin:1.25rem 0; padding:1rem; border:1px solid var(--border); border-radius:12px; background:#07111f; }
    .client strong, label { display:block; color:var(--text); }
    .client span { color:var(--muted); font-size:.86rem; overflow-wrap:anywhere; }
    label { margin:.9rem 0 .4rem; font-weight:650; }
    input { width:100%; padding:.8rem .85rem; border:1px solid #3a5272; border-radius:9px; color:var(--text); background:#030a14; font:inherit; }
    input:focus, button:focus-visible { outline:3px solid rgba(122,215,255,.4); outline-offset:2px; }
    .help { margin:.4rem 0 0; font-size:.82rem; }
    .warning { padding:.8rem .9rem; border-left:3px solid #ffcb78; background:rgba(255,203,120,.08); font-size:.88rem; }
    .error { padding:.75rem .9rem; border-left:3px solid var(--danger); background:rgba(255,90,90,.09); color:var(--danger); }
    .actions { display:flex; gap:.75rem; margin-top:1.25rem; }
    button { flex:1; min-height:44px; padding:.72rem; border:1px solid #3a5272; border-radius:9px; color:var(--text); background:#101d30; font:inherit; font-weight:700; cursor:pointer; }
    button[value="approve"] { border-color:var(--accent); color:#04101d; background:var(--accent); }
    footer { margin-top:1.25rem; color:var(--muted); font-size:.78rem; }
  </style>
</head>
<body>
  <main>
    <div class="brand">Delta-V authorization</div>
    <h1>Authorize a bot</h1>
    <p>Create or reuse a browser-local Delta-V bot identity and let this ChatGPT app play on its behalf.</p>
    <div class="client">
      <strong>${escapeHtml(opts.request.clientName)}</strong>
      <span>Returns to ${escapeHtml(redirectHost)}</span>
    </div>
    <p class="warning"><strong>Permission:</strong> play matches, send game actions and chat, and enter the public rated queue when asked. The app cannot access unrelated account or device data.</p>
    ${opts.error ? `<p class="error" role="alert">${escapeHtml(opts.error)}</p>` : ''}
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="request" value="${escapeHtml(opts.requestToken)}">
      <label for="callsign">Bot callsign</label>
      <input id="callsign" name="callsign" minlength="2" maxlength="20" required autocomplete="nickname" value="${escapeHtml(opts.username ?? '')}">
      <p class="help">Shown to opponents and on the agent leaderboard. Clearing this browser's cookies creates a new bot identity.</p>
      <div class="actions">
        <button type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="approve">Authorize bot</button>
      </div>
    </form>
    <footer>Only authorize clients you recognize. Delta-V never sends your access token to the model prompt.</footer>
  </main>
</body>
</html>`;
};

export const renderOAuthErrorPage = (
  message: string,
): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorization error — Delta-V</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;background:#040b16;color:#eef5ff;font-family:system-ui,sans-serif}main{max-width:34rem;padding:2rem;border:1px solid #31506b;border-radius:1rem;background:#0b1729}p{color:#b8c5d8;line-height:1.6}</style></head><body><main><h1>Authorization could not continue</h1><p>${escapeHtml(message)}</p><p>Close this window and try connecting Delta-V again.</p></main></body></html>`;
