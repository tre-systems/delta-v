import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = fileURLToPath(new URL('./', import.meta.url));
const CLIENT_IMPORT_PATTERN =
  /(?:from|import)\s+['"][^'"]*\/client\/[^'"]*['"]/g;

const collectTypeScriptFiles = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('server import boundaries', () => {
  it('does not import client modules from server files', () => {
    const violations = collectTypeScriptFiles(SERVER_ROOT).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, 'utf8');
        const matches = [...source.matchAll(CLIENT_IMPORT_PATTERN)];

        return matches.map(
          (match) =>
            `${relative(SERVER_ROOT, filePath)} -> ${match[0] ?? 'unknown import'}`,
        );
      },
    );

    expect(violations).toEqual([]);
  });
});
