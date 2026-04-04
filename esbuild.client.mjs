import { build } from 'esbuild';
import { copyStaticToDist } from './scripts/bundle-style-css.mjs';

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

const hash = copyStaticToDist();

console.log(`Client build complete (cache: delta-v-${hash})`);
