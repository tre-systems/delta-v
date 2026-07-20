import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';

const pages = [
  'static/index.html',
  'static/leaderboard.html',
  'static/matches.html',
];
const policyOwners = [
  'src/server/response-headers.ts',
  'static/_headers',
];

const ownerContents = await Promise.all(
  policyOwners.map(async (path) => [path, await readFile(path, 'utf8')]),
);

const failures = [];
for (const page of pages) {
  const html = await readFile(page, 'utf8');
  const scripts = [
    ...JSDOM.fragment(html).querySelectorAll('script:not([src])'),
  ];
  if (scripts.length !== 1) {
    failures.push(
      `${page}: expected exactly one inline script, found ${scripts.length}`,
    );
    continue;
  }
  const hash = `'sha256-${createHash('sha256')
    .update(scripts[0].textContent ?? '')
    .digest('base64')}'`;
  for (const [owner, content] of ownerContents) {
    if (!content.includes(hash)) {
      failures.push(`${owner}: missing ${page} CSP hash ${hash}`);
    }
  }
}

for (const [owner, content] of ownerContents) {
  const scriptPolicy = content.match(/script-src[^;\n]*/)?.[0] ?? '';
  if (scriptPolicy.includes("'unsafe-inline'")) {
    failures.push(`${owner}: script-src must not allow unsafe-inline`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('CSP inline-script hashes are current.');
}
