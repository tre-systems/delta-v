import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

import {
  BOOK_CSS,
  buildChapterIdByFile,
  chapterHtml,
  displayPath,
  escapeHtml,
  fileUrl,
  loadChapters,
  partBreakHtml,
  parts,
  tocHtml,
} from "./doc-book-shared.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "tmp", "documentation-book");
const rewrittenDir = path.join(repoRoot, "docs", "audio-rewritten");
const outHtml = path.join(outDir, "delta-v-documentation-book.audio.html");
const outPdf = path.join(outDir, "delta-v-documentation-book.audio.pdf");
const publishedPdf = path.join(
  repoRoot,
  "docs",
  "delta-v-documentation-book.audio.pdf",
);

await fs.mkdir(outDir, { recursive: true });

const chapters = await loadChapters(repoRoot);

const missing = [];
for (const chapter of chapters) {
  const rewrittenPath = path.join(rewrittenDir, chapter.file);
  try {
    const rewritten = await fs.readFile(rewrittenPath, "utf8");
    chapter.markdown = rewritten;
  } catch {
    missing.push(displayPath(chapter.file));
  }
}

if (missing.length > 0) {
  process.stderr.write(
    `Missing rewritten chapters under ${displayPath(path.relative(repoRoot, rewrittenDir))}:\n`,
  );
  for (const file of missing) {
    process.stderr.write(`  - ${file}\n`);
  }
  process.stderr.write(
    "Generate the rewrites first, then re-run this script.\n",
  );
  process.exit(1);
}

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
    <title>Delta-V Documentation Book - Audio Edition</title>
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
        <p class="cover-kicker">Delta-V Repository Book - Audio Edition</p>
        <h1>Project Documentation</h1>
        <p>
          A listener-friendly rewrite of the canonical documentation, produced for text-to-speech reading (for example, Speechify) while walking. Code blocks, tables, and file paths have been replaced with plain-English prose.
        </p>
        <p>
          This edition is lossy by design. For the faithful reference, use the standard documentation book.
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
      </div>
      <div>
        <img src="${escapeHtml(fileUrl(repoRoot, "screenshot.png"))}" alt="Delta-V gameplay screenshot" />
      </div>
    </section>

    <section class="toc">
      <h1>Contents</h1>
      <p>
        Chapters mirror the standard documentation book. Content has been rewritten for linear listening: code is described rather than quoted, tables are narrated, and forward references are inlined.
      </p>
      ${tocHtml(chapters)}
    </section>

    <section class="intro-note">
      <h1>How To Listen To This Book</h1>
      <ul>
        <li>Open the PDF in Speechify (or any TTS reader). The text is already cleaned up for listening.</li>
        <li>The standard documentation book is still the source of truth. Treat this edition as a walk-companion, not a reference.</li>
        <li>If a passage sounds wrong, check the standard edition before assuming the code disagrees.</li>
      </ul>
    </section>

    ${chapterSections.join("\n")}
  </body>
</html>
`;

await fs.writeFile(outHtml, html, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(outHtml).href, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__mermaidReady === true, null, {
  timeout: 10_000,
}).catch(() => null);
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: outPdf,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div></div>`,
  footerTemplate: `
    <div style="width:100%;font-size:9px;color:#667085;padding:0 12mm;font-family:Arial,Helvetica,sans-serif;display:flex;justify-content:space-between;">
      <span>Delta-V Documentation Book - Audio Edition</span>
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

const pdfBytes = await fs.readFile(outPdf);
const pdf = await PDFDocument.load(pdfBytes);
pdf.setTitle("Delta-V Documentation Book - Audio Edition");
pdf.setAuthor("Delta-V repository");
pdf.setSubject(
  "Listener-friendly rewrite of the Delta-V documentation book for text-to-speech reading.",
);
pdf.setKeywords([
  "Delta-V",
  "documentation",
  "audio edition",
  "text to speech",
  "agents",
]);
pdf.setProducer("pdf-lib");
pdf.setCreator("Delta-V documentation pipeline");
const rewrittenPdf = await pdf.save();
await fs.writeFile(outPdf, rewrittenPdf);
await fs.copyFile(outPdf, publishedPdf);

console.log(
  JSON.stringify({ html: outHtml, pdf: outPdf, publishedPdf, totalWords }, null, 2),
);
