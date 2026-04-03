import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

// Bundle client TypeScript into a single JS file
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  outfile: 'dist/client.js',
  format: 'esm',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  target: 'es2022',
});

// Copy static assets to dist/
cpSync('static', 'dist', { recursive: true });

// Inject build hash into service worker cache name
const clientJs = readFileSync('dist/client.js');
const swJs = readFileSync('dist/sw.js');
const styleCss = readFileSync('dist/style.css');
const importedStyles = readdirSync('dist/styles', { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((entry) => readFileSync(join('dist/styles', entry.name)));
const hashBuilder = createHash('sha256')
  .update(clientJs)
  .update(swJs)
  .update(styleCss);
for (const importedStyle of importedStyles) {
  hashBuilder.update(importedStyle);
}
const hash = hashBuilder.digest('hex').slice(0, 8);
const injectBuildHash = (content) => content.replaceAll('__BUILD_HASH__', hash);
writeFileSync(
  'dist/sw.js',
  injectBuildHash(readFileSync('dist/sw.js', 'utf8')),
);
writeFileSync(
  'dist/style.css',
  injectBuildHash(readFileSync('dist/style.css', 'utf8')),
);

// Cache-bust asset references in index.html
const indexHtml = readFileSync('dist/index.html', 'utf8');
writeFileSync(
  'dist/index.html',
  indexHtml
    .replace('/style.css', `/style.css?v=${hash}`)
    .replace('/client.js', `/client.js?v=${hash}`),
);

console.log(`Client build complete (cache: delta-v-${hash})`);
