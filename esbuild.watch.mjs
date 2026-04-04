import { watch } from 'node:fs';
import { context } from 'esbuild';
import { copyStaticToDist } from './scripts/bundle-style-css.mjs';

// Copy static → dist/, bundle CSS, inject SW / index cache-bust hashes
const refreshDistStatic = () => {
  const hash = copyStaticToDist();
  console.log(
    `[watch] dist/ refreshed (cache: delta-v-${hash}) at ${new Date().toLocaleTimeString()}`,
  );
};

// esbuild watch mode for TypeScript
const ctx = await context({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  outfile: 'dist/client.js',
  format: 'esm',
  sourcemap: true,
  target: 'es2022',
  plugins: [
    {
      name: 'copy-static',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            refreshDistStatic();
          }
        });
      },
    },
  ],
});

await ctx.watch();
console.log('[watch] watching src/ for changes...');

// Also watch static/ for CSS/HTML changes
watch('static', { recursive: true }, (_event, filename) => {
  if (!filename) return;
  refreshDistStatic();
});
