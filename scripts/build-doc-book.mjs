import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

import {
  BOOK_CSS,
  annexBreakHtml,
  buildChapterIdByFile,
  chapterHtml,
  displayPath,
  escapeHtml,
  fileUrl,
  loadChapters,
  niceAssetName,
  partBreakHtml,
  parts,
  tocHtml,
} from "./doc-book-shared.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "tmp", "documentation-book");
const outHtml = path.join(outDir, "delta-v-documentation-book.html");
const outPdf = path.join(outDir, "delta-v-documentation-book.pdf");
const outMainPdf = path.join(outDir, "delta-v-documentation-book.main.pdf");
const publishedPdf = path.join(repoRoot, "docs", "delta-v-documentation-book.pdf");

const appendixAssets = [
  "docs/map.png",
  ...(
    await fs.readdir(path.join(repoRoot, "docs", "assets"), { withFileTypes: true })
  )
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.posix.join("docs/assets", entry.name))
    .sort(),
];

const externalPdfAppendix = "docs/Triplanetary2018.pdf";

const chapters = await loadChapters(repoRoot);
const chapterIdByFile = buildChapterIdByFile(chapters);
const buildDate = new Date().toLocaleString("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/London",
});
const totalWords = chapters.reduce(
  (sum, chapter) => sum + chapter.markdown.split(/\s+/).filter(Boolean).length,
  0,
);

function visualAppendixHtml() {
  const mapFigure = `
    <section class="appendix-section">
      <h1>Appendix A. Strategic Map</h1>
      <p>The repository includes a visual map of the play space in <code>docs/map.png</code>.</p>
      <figure class="full-figure">
        <img class="doc-image" src="${escapeHtml(fileUrl(repoRoot, "docs/map.png"))}" alt="Delta-V strategic map" />
        <figcaption>${escapeHtml(displayPath("docs/map.png"))}</figcaption>
      </figure>
    </section>
  `;

  const assetFigures = appendixAssets
    .filter((asset) => asset !== "docs/map.png")
    .map(
      (asset) => `
        <figure class="gallery-item">
          <img class="doc-image" src="${escapeHtml(fileUrl(repoRoot, asset))}" alt="${escapeHtml(niceAssetName(asset))}" />
          <figcaption>${escapeHtml(niceAssetName(asset))}<br /><span>${escapeHtml(displayPath(asset))}</span></figcaption>
        </figure>
      `,
    )
    .join("");

  return `
    ${mapFigure}
    <section class="appendix-section">
      <h1>Appendix B. Concept Art Boards</h1>
      <p>The lore guide references these raster boards in <code>docs/assets/</code>. They are included here as a browsable visual appendix.</p>
      <div class="gallery-grid">
        ${assetFigures}
      </div>
    </section>
    ${annexBreakHtml(
      "External Reference PDF",
      `The original ${displayPath(
        externalPdfAppendix,
      )} is appended after this divider so the final output remains a single consolidated PDF.`,
    )}
  `;
}

function imprintHtml() {
  return `
    <section class="intro-note">
      <h1>Editorial Note</h1>
      <p>
        This edition is arranged as a handbook rather than a file dump. Stable architectural and rules material appears first. More volatile operational worksheets and the live backlog are intentionally moved to the end as annexes.
      </p>
      <p>
        The Markdown files remain the canonical source. This book is an edited reading order over those sources, not an alternative authority.
      </p>
    </section>
  `;
}

const chapterSections = [];
for (const [index, part] of parts.entries()) {
  chapterSections.push(partBreakHtml(part, index + 1));
  for (const chapter of chapters.filter((item) => item.partTitle === part.title)) {
    chapterSections.push(chapterHtml(chapter, chapterIdByFile, repoRoot));
  }
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Delta-V Documentation Book</title>
    <style>${BOOK_CSS}</style>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
    <script>
      window.__mermaidReady = false;
      window.addEventListener("load", async () => {
        if (!window.mermaid) {
          window.__mermaidReady = true;
          return;
        }
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "neutral",
        });
        const nodes = document.querySelectorAll(".mermaid");
        if (nodes.length === 0) {
          window.__mermaidReady = true;
          return;
        }
        await window.mermaid.run({ nodes });
        window.__mermaidReady = true;
      });
    </script>
  </head>
  <body>
    <section class="cover">
      <div class="cover-panel">
        <p class="cover-kicker">Delta-V Repository Book</p>
        <h1>Project Documentation</h1>
        <p>
          A single, linear PDF assembled from the repository's canonical documentation, intended to be read front-to-back like a technical handbook.
        </p>
        <div class="stats">
          <div class="stat">
            <strong>Chapters</strong>
            <span>${chapters.length}</span>
          </div>
          <div class="stat">
            <strong>Words</strong>
            <span>${totalWords.toLocaleString("en-GB")}</span>
          </div>
          <div class="stat">
            <strong>Built</strong>
            <span>${escapeHtml(buildDate)}</span>
          </div>
          <div class="stat">
            <strong>Source</strong>
            <span>${escapeHtml(path.basename(repoRoot))}</span>
          </div>
        </div>
        <p class="source-note">
          Includes all canonical Markdown docs, the visual reference boards under docs/assets/, and the original appended ${escapeHtml(displayPath(externalPdfAppendix))}.
        </p>
      </div>
      <div>
        <img src="${escapeHtml(fileUrl(repoRoot, "screenshot.png"))}" alt="Delta-V gameplay screenshot" />
      </div>
    </section>

    <section class="toc">
      <h1>Contents</h1>
      <p>
        The book is ordered for comprehension rather than alphabetically. Orientation comes first, followed by architecture and patterns, then rules, operations, integrations, and finally the more volatile annex material.
      </p>
      ${tocHtml(chapters)}
    </section>

    ${imprintHtml()}

    <section class="intro-note">
      <h1>How To Read This Book</h1>
      <ul>
        <li>Read Parts I and II first if you want to understand the system shape before touching code.</li>
        <li>Read Part III if you are changing game rules, scenarios, or art direction.</li>
        <li>Read Part IV if you are shipping, testing, hardening, or diagnosing the project.</li>
        <li>Read Part V if you are building external agents or integrating via MCP or raw protocols.</li>
        <li>Treat Part VI as annex material: useful, but more time-sensitive than the core handbook.</li>
        <li>The appendix gathers the non-Markdown visual references and the original bundled PDF so the output is genuinely consolidated.</li>
      </ul>
    </section>

    ${chapterSections.join("\n")}
    ${visualAppendixHtml()}
  </body>
</html>
`;

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outHtml, html, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(outHtml).href, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__mermaidReady === true, null, {
  timeout: 10_000,
}).catch(() => null);
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: outMainPdf,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div></div>`,
  footerTemplate: `
    <div style="width:100%;font-size:9px;color:#667085;padding:0 12mm;font-family:Arial,Helvetica,sans-serif;display:flex;justify-content:space-between;">
      <span>Delta-V Documentation Book</span>
      <span class="pageNumber"></span>
    </div>
  `,
  margin: {
    top: "18mm",
    right: "14mm",
    bottom: "18mm",
    left: "14mm",
  },
});
await browser.close();

const mergedPdf = await PDFDocument.create();

for (const pdfPath of [outMainPdf, path.join(repoRoot, externalPdfAppendix)]) {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdf = await PDFDocument.load(pdfBytes);
  const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
  for (const copiedPage of copiedPages) {
    mergedPdf.addPage(copiedPage);
  }
}

mergedPdf.setTitle("Delta-V Documentation Book");
mergedPdf.setAuthor("Delta-V repository");
mergedPdf.setSubject(
  "Technical handbook compiled from the canonical Delta-V repository documentation.",
);
mergedPdf.setKeywords([
  "Delta-V",
  "documentation",
  "architecture",
  "game rules",
  "MCP",
  "agents",
]);
mergedPdf.setProducer("pdf-lib");
mergedPdf.setCreator("Delta-V documentation pipeline");

const mergedBytes = await mergedPdf.save();
await fs.writeFile(outPdf, mergedBytes);
await fs.copyFile(outPdf, publishedPdf);

console.log(
  JSON.stringify(
    {
      html: outHtml,
      pdf: outPdf,
      mainPdf: outMainPdf,
      publishedPdf,
    },
    null,
    2,
  ),
);
