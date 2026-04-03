import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHARED_ROOT = fileURLToPath(new URL('./', import.meta.url));
const CLIENT_ROOT = join(SRC_ROOT, 'client');
const ENGINE_ROOT = join(SHARED_ROOT, 'engine');

// Matches import/export-from statements and extracts the module specifier.
const IMPORT_PATTERN =
  /(?:from|import)\s+['"]([^'"]+)['"]/g;

// Recursively collect all .ts files, skipping test files.
const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip __fixtures__ directories
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

// Check whether an import specifier references a given layer.
const importsLayer = (specifier: string, layer: string): boolean =>
  specifier.includes(`/${layer}/`) || specifier.startsWith(`${layer}/`);

// Scan files for imports that violate a boundary and return violation strings.
const findViolations = (
  root: string,
  forbiddenLayers: string[],
): string[] => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(root)) {
    const source = readFileSync(filePath, 'utf8');

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1]!;

      for (const layer of forbiddenLayers) {
        if (importsLayer(specifier, layer)) {
          const rel = relative(root, filePath);
          violations.push(`${rel} imports "${specifier}" (forbidden: ${layer})`);
        }
      }
    }
  }

  return violations;
};

describe('import boundaries', () => {
  it('shared/ never imports from client/ or server/', () => {
    const violations = findViolations(SHARED_ROOT, ['client', 'server']);
    expect(violations).toEqual([]);
  });

  it('client/ never imports from server/', () => {
    const violations = findViolations(CLIENT_ROOT, ['server']);
    expect(violations).toEqual([]);
  });

  it('shared/engine/ never imports from client/ or server/', () => {
    const violations = findViolations(ENGINE_ROOT, ['client', 'server']);
    expect(violations).toEqual([]);
  });
});
