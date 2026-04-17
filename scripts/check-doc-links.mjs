#!/usr/bin/env node
// Verify internal markdown links (file + anchor) across docs/, patterns/, README.md, AGENT_SPEC.md.
// Usage: node scripts/check-doc-links.mjs  (exit 0 on success, 1 if any broken links)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ROOTS = ['README.md', 'AGENT_SPEC.md', 'docs', 'patterns'];

const walk = (p) => {
  const full = resolve(ROOT, p);
  try {
    if (statSync(full).isDirectory()) {
      return readdirSync(full).flatMap((child) => walk(join(p, child)));
    }
  } catch {
    return [];
  }
  return full.endsWith('.md') ? [p] : [];
};

const files = ROOTS.flatMap(walk);

// GitHub-style anchor slug: lowercase, spaces -> hyphens, strip most punctuation.
const slugify = (heading) =>
  heading
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

// Build { file -> Set<anchor> } for every doc.
const headingsByFile = new Map();

for (const file of files) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const anchors = new Set();
  // Skip fenced code blocks so '# inside code' doesn't count.
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) anchors.add(slugify(match[2]));
  }
  headingsByFile.set(file, anchors);
}

const errors = [];

for (const file of files) {
  const abs = resolve(ROOT, file);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split('\n');

  // Strip fenced code blocks so links inside ``` don't get checked.
  const mask = new Array(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      inFence = !inFence;
      mask[i] = true;
      continue;
    }
    mask[i] = inFence;
  }

  // Match [text](href) excluding images ![...](...).
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g;

  lines.forEach((line, i) => {
    if (mask[i]) return;
    // Strip inline code spans so [foo](bar) inside `code` isn't treated as a link.
    const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    let m;
    while ((m = linkRe.exec(stripped)) !== null) {
      const href = m[2];
      // Only check internal links (not http/https/mailto/anchors in same file).
      if (/^[a-z]+:/i.test(href) || href.startsWith('#')) {
        if (href.startsWith('#')) {
          const anchor = href.slice(1);
          if (!headingsByFile.get(file)?.has(anchor)) {
            errors.push(`${file}:${i + 1}  missing anchor  ${href}`);
          }
        }
        continue;
      }

      const [pathPart, anchor] = href.split('#');
      const targetAbs = resolve(dirname(abs), pathPart);
      const targetRel = relative(ROOT, targetAbs);

      try {
        statSync(targetAbs);
      } catch {
        errors.push(`${file}:${i + 1}  missing file  ${href}  (resolves to ${targetRel})`);
        continue;
      }

      if (anchor && targetAbs.endsWith('.md')) {
        const anchors = headingsByFile.get(targetRel);
        if (anchors && !anchors.has(anchor)) {
          errors.push(`${file}:${i + 1}  missing anchor  ${href}  (in ${targetRel})`);
        }
      }
    }
  });
}

if (errors.length === 0) {
  console.log(`OK — checked ${files.length} markdown files, no broken internal links.`);
  process.exit(0);
}

console.error(`Found ${errors.length} broken link(s):\n`);
for (const err of errors) console.error('  ' + err);
process.exit(1);
