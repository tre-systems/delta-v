#!/usr/bin/env node
// WebSocket replacement-behavior harness.
//
// The 2026-04-24 multiplayer probe noticed that on `wrangler dev` a second
// WebSocket reusing the same `playerToken` did not visibly close the prior
// socket — the old one stayed `OPEN` and just stopped receiving broadcasts.
// `game-do.ts` calls `old.close(1000, 'Replaced by new connection')` so the
// expected outcome is a clean close on the prior socket within ~seconds.
//
// This script reproduces that probe locally (or against any base URL) so we
// can triangulate whether the issue is `wrangler dev` hibernation, the Node
// `undici` WebSocket client, or a real prod regression. Run twice: once
// against `npm run dev:watch` (defaults to ws://localhost:8787) and once
// against `wss://delta-v.tre.systems`.
//
// Usage:
//   node scripts/mp-connectivity.mjs [base-url]
//   node scripts/mp-connectivity.mjs https://delta-v.tre.systems
//
// Exit status: 0 if replacement closed the prior socket within the timeout,
// 1 otherwise.

const DEFAULT_BASE = 'http://localhost:8787';
const REPLACE_TIMEOUT_MS = 8000;

const baseHttp = (process.argv[2] ?? DEFAULT_BASE).replace(/\/$/, '');
const baseWs = baseHttp.replace(/^http/, 'ws');

const log = (...parts) => console.log(`[mp-connectivity]`, ...parts);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createRoom = async () => {
  const res = await fetch(`${baseHttp}/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'biplanetary' }),
  });
  if (!res.ok) {
    throw new Error(`POST /create failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  if (typeof body?.code !== 'string') {
    throw new Error(`POST /create returned unexpected body: ${JSON.stringify(body)}`);
  }
  return body.code;
};

const waitForWelcome = (ws) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for welcome frame')),
      5000,
    );
    ws.addEventListener('message', (ev) => {
      let parsed;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (parsed?.type === 'welcome' && typeof parsed.playerToken === 'string') {
        clearTimeout(timer);
        resolve(parsed.playerToken);
      }
    });
    ws.addEventListener('close', (ev) => {
      clearTimeout(timer);
      reject(
        new Error(
          `socket closed before welcome (code=${ev.code} reason=${ev.reason})`,
        ),
      );
    });
    ws.addEventListener('error', () => {
      // 'error' on undici WS is typically followed by 'close' which carries
      // the diagnostic; let the close handler reject.
    });
  });

const openSocket = (code, playerToken) =>
  new Promise((resolve, reject) => {
    const url = `${baseWs}/ws/${code}?playerToken=${encodeURIComponent(playerToken)}`;
    const ws = new WebSocket(url);
    const timer = setTimeout(
      () => reject(new Error(`timed out opening socket to ${url}`)),
      5000,
    );
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('close', (ev) => {
      clearTimeout(timer);
      reject(
        new Error(`socket failed to open (code=${ev.code} reason=${ev.reason})`),
      );
    });
  });

const watchClose = (ws) =>
  new Promise((resolve) => {
    const start = Date.now();
    ws.addEventListener('close', (ev) => {
      resolve({ code: ev.code, reason: ev.reason, elapsedMs: Date.now() - start });
    });
  });

const main = async () => {
  log(`base: ${baseHttp}`);

  const code = await createRoom();
  log(`created room ${code}`);

  // Open the host socket without a token — server welcomes us as player 0
  // and hands back the persistent playerToken in the welcome frame.
  const initialUrl = `${baseWs}/ws/${code}`;
  const initialWs = new WebSocket(initialUrl);
  await new Promise((resolve, reject) => {
    initialWs.addEventListener('open', resolve);
    initialWs.addEventListener('close', (ev) =>
      reject(new Error(`initial open failed code=${ev.code} reason=${ev.reason}`)),
    );
    initialWs.addEventListener('error', () => {});
  });
  log(`socket A opened`);

  const playerToken = await waitForWelcome(initialWs);
  log(`captured playerToken (len=${playerToken.length})`);

  // Now race a second socket reusing the same token. The DO is expected to
  // close socket A with code 1000.
  const closeWatcher = watchClose(initialWs);

  const replacementWs = await openSocket(code, playerToken);
  log(`socket B opened with the same playerToken`);

  const closeOutcome = await Promise.race([
    closeWatcher.then((info) => ({ kind: 'closed', ...info })),
    sleep(REPLACE_TIMEOUT_MS).then(() => ({
      kind: 'still_open',
      readyState: initialWs.readyState,
    })),
  ]);

  // Tidy up so the script doesn't hang on lingering sockets.
  try { replacementWs.close(); } catch {}
  try { initialWs.close(); } catch {}

  if (closeOutcome.kind === 'closed') {
    log(`PASS — socket A closed in ${closeOutcome.elapsedMs}ms`);
    log(`      code=${closeOutcome.code} reason=${JSON.stringify(closeOutcome.reason)}`);
    if (closeOutcome.code !== 1000) {
      log(`      WARNING: expected code 1000, got ${closeOutcome.code}`);
      process.exit(1);
    }
    process.exit(0);
  }

  log(`FAIL — socket A still open after ${REPLACE_TIMEOUT_MS}ms (readyState=${closeOutcome.readyState})`);
  log(`       Socket A should have been closed by the DO. This matches the`);
  log(`       backlog symptom. Re-run against production to triangulate.`);
  process.exit(1);
};

main().catch((err) => {
  console.error(`[mp-connectivity] error:`, err);
  process.exit(2);
});
