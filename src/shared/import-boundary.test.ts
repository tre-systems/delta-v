import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHARED_ROOT = fileURLToPath(new URL('./', import.meta.url));
const CLIENT_ROOT = join(SRC_ROOT, 'client');
const ENGINE_ROOT = join(SHARED_ROOT, 'engine');

// Matches import/export-from statements and extracts the module specifier.
const IMPORT_PATTERN = /(?:from|import)\s+['"]([^'"]+)['"]/g;

// Platform-specific identifiers that must not appear in engine code.
// These indicate coupling to a specific runtime (browser DOM or Cloudflare Workers).
const PLATFORM_APIS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  { pattern: /\bdocument\b/, label: 'DOM API (document)' },
  { pattern: /\bwindow\b/, label: 'DOM API (window)' },
  { pattern: /\bHTMLElement\b/, label: 'DOM API (HTMLElement)' },
  { pattern: /\baddEventListener\b/, label: 'DOM API (addEventListener)' },
  { pattern: /\bDurableObject\b/, label: 'Cloudflare API (DurableObject)' },
  {
    pattern: /\bDurableObjectState\b/,
    label: 'Cloudflare API (DurableObjectState)',
  },
  { pattern: /\bKVNamespace\b/, label: 'Cloudflare API (KVNamespace)' },
  { pattern: /\bR2Bucket\b/, label: 'Cloudflare API (R2Bucket)' },
  {
    pattern: /\bExecutionContext\b/,
    label: 'Cloudflare API (ExecutionContext)',
  },
];

// Recursively collect all .ts files, skipping test files and fixtures.
const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__') continue;
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.property.test.ts')
    ) {
      files.push(fullPath);
    }
  }

  return files;
};

// Check whether an import specifier references a given layer via
// relative paths (e.g. ../client/foo) or bare layer names (client/foo).
const importsLayer = (specifier: string, layer: string): boolean =>
  specifier.includes(`/${layer}/`) ||
  specifier.startsWith(`${layer}/`) ||
  specifier.endsWith(`/${layer}`) ||
  specifier === layer;

// Scan files for imports that violate a boundary and return violation strings.
const findViolations = (root: string, forbiddenLayers: string[]): string[] => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(root)) {
    const source = readFileSync(filePath, 'utf8');

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? '';

      for (const layer of forbiddenLayers) {
        if (importsLayer(specifier, layer)) {
          const rel = relative(root, filePath);
          violations.push(
            `${rel} imports "${specifier}" — ${layer}/ is off-limits from this layer`,
          );
        }
      }
    }
  }

  return violations;
};

// Scan files for platform-specific API usage (global identifiers, not imports).
const findPlatformViolations = (root: string): string[] => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(root)) {
    const source = readFileSync(filePath, 'utf8');

    // Strip single-line and block comments so we don't flag references
    // that only appear in documentation.
    const stripped = source
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    for (const { pattern, label } of PLATFORM_APIS) {
      if (pattern.test(stripped)) {
        const rel = relative(root, filePath);
        violations.push(`${rel} references ${label}`);
      }
    }
  }

  return violations;
};

describe('import boundaries', () => {
  it('shared/ never imports from client/ or server/', () => {
    const violations = findViolations(SHARED_ROOT, ['client', 'server']);
    expect(
      violations,
      [
        'shared/ must not import from client/ or server/.',
        'Layer order: server → client → shared (dependencies point inward).',
        'Violations:',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('client/ never imports from server/', () => {
    const violations = findViolations(CLIENT_ROOT, ['server']);
    expect(
      violations,
      [
        'client/ must not import from server/.',
        'If you need shared types, move them to shared/.',
        'Violations:',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('shared/engine/ never imports from client/ or server/', () => {
    const violations = findViolations(ENGINE_ROOT, ['client', 'server']);
    expect(
      violations,
      [
        'shared/engine/ must not import from client/ or server/.',
        'The engine is the innermost layer — it depends only on shared types.',
        'Violations:',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('shared/engine/ never references platform-specific APIs', () => {
    const violations = findPlatformViolations(ENGINE_ROOT);
    expect(
      violations,
      [
        'shared/engine/ must not reference platform-specific APIs.',
        'The engine must remain portable across browser and Cloudflare Workers.',
        'Move platform code to client/ or server/ and pass data in via function args.',
        'Violations:',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });
});
