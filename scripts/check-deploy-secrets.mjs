#!/usr/bin/env node
// Pre-deploy gate: refuse to ship when required production secrets are missing on
// the target Cloudflare environment. Runs `wrangler secret list` (which
// hits the remote environment) and exits 1 if the expected secret is
// absent, so a careless `npm run deploy` can't accidentally ship a
// Worker that silently falls through to dev placeholders.
//
// Skip with DELTA_V_SKIP_DEPLOY_CHECK=1 when the deploy is deliberate
// (e.g. first deploy on a fresh environment that is about to receive
// the secret).

import { spawnSync } from 'node:child_process';

const REQUIRED_SECRETS = ['AGENT_TOKEN_SECRET'];

if (process.env.DELTA_V_SKIP_DEPLOY_CHECK === '1') {
  console.log('check-deploy-secrets: skipped via DELTA_V_SKIP_DEPLOY_CHECK=1');
  process.exit(0);
}

const result = spawnSync(
  'npx',
  ['--no-install', 'wrangler', 'secret', 'list'],
  { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
);

if (result.status !== 0) {
  console.error('check-deploy-secrets: `wrangler secret list` failed.');
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch {
  // Older wrangler prints a human-readable table. Grep the raw output.
  parsed = null;
}

const names = new Set(
  parsed && Array.isArray(parsed)
    ? parsed.map((row) => row.name)
    : result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
);

const missing = REQUIRED_SECRETS.filter((secret) => {
  if (names.has(secret)) return false;
  return !result.stdout.includes(secret);
});

if (missing.length > 0) {
  console.error(
    `check-deploy-secrets: missing required secrets on this environment: ${missing.join(', ')}`,
  );
  console.error(
    `Set them with:  ${missing.map((secret) => `wrangler secret put ${secret}`).join('  &&  ')}   (then rerun deploy)`,
  );
  console.error(
    'Override for an intentional first deploy:  DELTA_V_SKIP_DEPLOY_CHECK=1 npm run deploy',
  );
  process.exit(1);
}

console.log(
  `check-deploy-secrets: all required secrets present (${REQUIRED_SECRETS.join(', ')}).`,
);
