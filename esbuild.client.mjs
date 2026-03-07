import { build } from 'esbuild';
import { cpSync } from 'fs';

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

console.log('Client build complete');
