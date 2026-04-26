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
// Exit status: 0 if replacement notifies and closes the prior socket within
// the timeout, 1 otherwise.

import WebSocket from 'ws';

const DEFAULT_BASE = 'http://localhost:8787';
const REPLACE_TIMEOUT_MS = 8000;
const REPLACED_CODE = 'SESSION_REPLACED';
const REPLACED_CLOSE_REASON = 'Replaced by new connection';

const baseHttp = (process.argv[2] ?? DEFAULT_BASE).replace(/\/$/, '');
const baseWs = baseHttp.replace(/^http/, 'ws');

const log = (...parts) => console.log(`[mp-connectivity]`, ...parts);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseJsonFrame = (data) => {
  const text =
    typeof data === 'string'
      ? data
      : data instanceof Buffer
        ? data.toString('utf8')
        : String(data ?? '');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

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
      const parsed = parseJsonFrame(ev.data);
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

const watchReplacementOutcome = (ws) =>
  new Promise((resolve) => {
    const start = Date.now();
    let replacementFrame = null;

    ws.addEventListener('message', (ev) => {
      const parsed = parseJsonFrame(ev.data);
      if (parsed?.type === 'error' && parsed.code === REPLACED_CODE) {
        replacementFrame = {
          code: parsed.code,
          message:
            typeof parsed.message === 'string' ? parsed.message : undefined,
          elapsedMs: Date.now() - start,
        };
      }
    });

    ws.addEventListener('close', (ev) => {
      resolve({
        replacementFrame,
        closeCode: ev.code,
        closeReason: ev.reason,
        elapsedMs: Date.now() - start,
      });
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
  // send an explicit SESSION_REPLACED frame, then close socket A with code 1000.
  const replacementWatcher = watchReplacementOutcome(initialWs);

  const replacementWs = await openSocket(code, playerToken);
  log(`socket B opened with the same playerToken`);

  const closeOutcome = await Promise.race([
    replacementWatcher.then((info) => ({ kind: 'replaced', ...info })),
    sleep(REPLACE_TIMEOUT_MS).then(() => ({
      kind: 'timed_out',
      readyState: initialWs.readyState,
    })),
  ]);

  // Tidy up so the script doesn't hang on lingering sockets.
  try { replacementWs.close(); } catch {}
  try { initialWs.close(); } catch {}

  if (closeOutcome.kind === 'replaced') {
    log(`socket A replacement frame: ${JSON.stringify(closeOutcome.replacementFrame)}`);
    log(`socket A closed in ${closeOutcome.elapsedMs}ms`);
    log(
      `      code=${closeOutcome.closeCode} reason=${JSON.stringify(closeOutcome.closeReason)}`,
    );
    if (closeOutcome.replacementFrame?.code !== REPLACED_CODE) {
      log(`FAIL — expected ${REPLACED_CODE} frame before close`);
      process.exit(1);
    }
    if (closeOutcome.closeCode !== 1000) {
      log(`FAIL — expected close code 1000, got ${closeOutcome.closeCode}`);
      process.exit(1);
    }
    if (closeOutcome.closeReason !== REPLACED_CLOSE_REASON) {
      log(
        `FAIL — expected close reason ${JSON.stringify(REPLACED_CLOSE_REASON)}, got ${JSON.stringify(closeOutcome.closeReason)}`,
      );
      process.exit(1);
    }
    log(`PASS — socket A was explicitly replaced`);
    process.exit(0);
  }

  log(
    `FAIL — socket A did not finish replacement after ${REPLACE_TIMEOUT_MS}ms (readyState=${closeOutcome.readyState})`,
  );
  log(`       Expected ${REPLACED_CODE} followed by close code 1000.`);
  process.exit(1);
};

main().catch((err) => {
  console.error(`[mp-connectivity] error:`, err);
  process.exit(2);
});
