import { createHash } from 'node:crypto';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
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
const styleCss = readFileSync('dist/style.css');
const hash = createHash('sha256')
  .update(clientJs)
  .update(styleCss)
  .digest('hex')
  .slice(0, 8);
const swSource = readFileSync('dist/sw.js', 'utf8');
writeFileSync('dist/sw.js', swSource.replace('delta-v-v1', `delta-v-${hash}`));

console.log(`Client build complete (cache: delta-v-${hash})`);
