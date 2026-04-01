import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { context } from 'esbuild';
import { watch } from 'node:fs';

// Rebuild static assets (HTML, CSS, SW) into dist/
const copyStatic = () => {
  cpSync('static', 'dist', { recursive: true });

  const clientJs = readFileSync('dist/client.js');
  const styleCss = readFileSync('dist/style.css');
  const hash = createHash('sha256')
    .update(clientJs)
    .update(styleCss)
    .digest('hex')
    .slice(0, 8);
  const swSource = readFileSync('dist/sw.js', 'utf8');
  writeFileSync(
    'dist/sw.js',
    swSource.replace('delta-v-v1', `delta-v-${hash}`),
  );

  const indexHtml = readFileSync('dist/index.html', 'utf8');
  writeFileSync(
    'dist/index.html',
    indexHtml
      .replace('/style.css', `/style.css?v=${hash}`)
      .replace('/client.js', `/client.js?v=${hash}`),
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
            copyStatic();
            console.log(`[watch] rebuilt at ${new Date().toLocaleTimeString()}`);
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
  copyStatic();
  console.log(
    `[watch] static/${filename} updated at ${new Date().toLocaleTimeString()}`,
  );
});
