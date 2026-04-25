import { createHash } from 'node:crypto';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Matches `@import url('/path?query');` from static/style.css */
const STYLE_IMPORT_RE =
  /@import\s+url\((['"]?)(\/[^'")?]+)(?:\?[^'")]*)?\1\)\s*;/g;

/**
 * Inlines absolute-path CSS imports from `style.css` into one stylesheet.
 * Sources live under `static/`; run after copying static → `dist/`.
 */
export function bundleStyleCss(rootDir) {
  const entryPath = join(rootDir, 'style.css');
  const src = readFileSync(entryPath, 'utf8');
  let out = '';
  let lastIndex = 0;
  let match;
  const re = new RegExp(STYLE_IMPORT_RE.source, 'g');
  while ((match = re.exec(src)) !== null) {
    out += src.slice(lastIndex, match.index);
    const urlPath = match[2];
    const filePath = join(rootDir, urlPath.slice(1));
    out += `${readFileSync(filePath, 'utf8')}\n`;
    lastIndex = re.lastIndex;
  }
  out += src.slice(lastIndex);
  return `${out.trim()}\n`;
}

/**
 * Writes `dist/style.css` (bundled), injects `__BUILD_HASH__` into SW and CSS,
 * and cache-busts `index.html` asset URLs with a `?v=<hash>` query.
 *
 * The hash query lets us pair an immutable cache header with the assets
 * (see `static/_headers`). New builds get a new query, browsers cache each
 * version forever, and revalidation round-trips disappear for repeat visits.
 */
export function postprocessDistStatic() {
  const clientJs = readFileSync('dist/client.js');
  const swTemplate = readFileSync('dist/sw.js', 'utf8');
  const bundledCss = bundleStyleCss('dist');
  const hash = createHash('sha256')
    .update(clientJs)
    .update(swTemplate)
    .update(bundledCss)
    .digest('hex')
    .slice(0, 8);

  const injectBuildHash = (content) => content.replaceAll('__BUILD_HASH__', hash);

  writeFileSync('dist/sw.js', injectBuildHash(swTemplate));
  writeFileSync('dist/style.css', injectBuildHash(bundledCss));

  const indexHtml = readFileSync('dist/index.html', 'utf8');
  writeFileSync(
    'dist/index.html',
    indexHtml
      .replace('/style.css', `/style.css?v=${hash}`)
      .replace('/client.js', `/client.js?v=${hash}`),
  );

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync(
    'dist/version.json',
    `${JSON.stringify(
      {
        packageVersion: pkg.version ?? '0.0.0',
        assetsHash: hash,
      },
      null,
      2,
    )}\n`,
  );

  return hash;
}

/** Copy `static/` into `dist/` and run bundle + hash injection. */
export function copyStaticToDist() {
  cpSync('static', 'dist', { recursive: true });
  return postprocessDistStatic();
}
