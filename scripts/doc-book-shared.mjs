import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { marked } from "marked";

export const parts = [
  {
    title: "Part I. Orientation",
    intro:
      "Start here for the product overview, contributor workflow, and the main architectural frame of the codebase.",
    files: ["README.md", "docs/CONTRIBUTING.md", "docs/ARCHITECTURE.md"],
  },
  {
    title: "Part II. Design Patterns and Contracts",
    intro:
      "These chapters explain the recurring engineering choices in the system: boundaries, state flow, persistence, validation, scenarios, and testing.",
    files: [
      "docs/CODING_STANDARDS.md",
      "patterns/README.md",
      "patterns/engine-and-architecture.md",
      "patterns/protocol-and-persistence.md",
      "patterns/client.md",
      "patterns/type-system-and-validation.md",
      "patterns/scenarios-and-config.md",
      "patterns/testing.md",
      "docs/PROTOCOL.md",
    ],
  },
  {
    title: "Part III. Game Design and World",
    intro:
      "This section covers the canonical rules, scenarios, and the visual direction of the setting and ship roster.",
    files: ["docs/SPEC.md", "docs/LORE.md"],
  },
  {
    title: "Part IV. Quality, Operations, and Release",
    intro:
      "Operational guidance for testing, accessibility, observability, security, privacy, reviews, and coordinated releases.",
    files: [
      "docs/SIMULATION_TESTING.md",
      "docs/MANUAL_TEST_PLAN.md",
      "docs/EXPLORATORY_TESTING.md",
      "docs/A11Y.md",
      "docs/OBSERVABILITY.md",
      "docs/SECURITY.md",
      "docs/PRIVACY_TECHNICAL.md",
      "docs/REVIEW_PLAN.md",
      "docs/COORDINATED_RELEASE_CHECKLIST.md",
    ],
  },
  {
    title: "Part V. Agents and Integrations",
    intro:
      "Everything needed to understand the agent-facing APIs, MCP integration, and the deeper agent protocol model.",
    files: ["docs/AGENTS.md", "docs/DELTA_V_MCP.md", "AGENT_SPEC.md"],
  },
  {
    title: "Part VI. Current Project State",
    intro:
      "The current backlog closes the book with the remaining open work and priority ordering.",
    files: ["docs/BACKLOG.md"],
  },
];

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, "")
    .replace(/[`*_~()[\]{}:;,.!?/\\|"'@#$%^&+=<>]/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function displayPath(relativePath) {
  return relativePath.replaceAll(path.sep, "/");
}

export function fileUrl(repoRoot, relativePath) {
  return pathToFileURL(path.join(repoRoot, relativePath)).href;
}

export function chapterTitleFromMarkdown(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

export function stripLeadingTitle(markdown) {
  return markdown.replace(/^#\s+.+\n+/, "");
}

export function niceAssetName(relativePath) {
  const name = path.basename(relativePath, path.extname(relativePath));
  return name
    .replace(/_\d+$/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function loadChapters(repoRoot) {
  const chapters = [];
  let chapterNumber = 1;

  for (const part of parts) {
    for (const file of part.files) {
      const markdown = await fs.readFile(path.join(repoRoot, file), "utf8");
      const title = chapterTitleFromMarkdown(markdown, file);
      chapters.push({
        partTitle: part.title,
        number: chapterNumber,
        chapterId: `chapter-${String(chapterNumber).padStart(2, "0")}-${slugify(title) || "untitled"}`,
        file,
        title,
        markdown,
      });
      chapterNumber += 1;
    }
  }

  return chapters;
}

export function buildChapterIdByFile(chapters) {
  return new Map(chapters.map((chapter) => [displayPath(chapter.file), chapter.chapterId]));
}

function resolveHref(rawHref, sourceFile, currentChapterId, chapterIdByFile, repoRoot) {
  if (!rawHref) return rawHref;
  if (/^(https?:|mailto:|tel:)/i.test(rawHref)) return rawHref;

  if (rawHref.startsWith("#")) {
    return `#${currentChapterId}--${slugify(rawHref.slice(1))}`;
  }

  const [pathname, fragment] = rawHref.split("#");
  const resolved = displayPath(path.normalize(path.join(path.dirname(sourceFile), pathname)));
  const extension = path.extname(resolved).toLowerCase();

  if (chapterIdByFile.has(resolved)) {
    const chapterHref = `#${chapterIdByFile.get(resolved)}`;
    return fragment ? `${chapterHref}--${slugify(fragment)}` : chapterHref;
  }

  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf"].includes(extension)) {
    const absoluteFile = path.join(repoRoot, resolved);
    return pathToFileURL(absoluteFile).href;
  }

  return rawHref;
}

function resolveImage(rawHref, sourceFile, repoRoot) {
  if (!rawHref) return rawHref;
  if (/^(https?:|data:|file:)/i.test(rawHref)) return rawHref;
  const resolved = path.join(repoRoot, path.normalize(path.join(path.dirname(sourceFile), rawHref)));
  return pathToFileURL(resolved).href;
}

export function createRenderer(chapter, chapterIdByFile, repoRoot) {
  const renderer = new marked.Renderer();
  const headingCounts = new Map();

  renderer.heading = function heading(token) {
    const baseSlug = slugify(token.text) || "section";
    const seen = headingCounts.get(baseSlug) ?? 0;
    headingCounts.set(baseSlug, seen + 1);
    const uniqueSlug = seen === 0 ? baseSlug : `${baseSlug}-${seen}`;
    const id = `${chapter.chapterId}--${uniqueSlug}`;
    const inner = this.parser.parseInline(token.tokens);
    return `<h${token.depth} id="${escapeHtml(id)}">${inner}</h${token.depth}>`;
  };

  renderer.link = function link(token) {
    const href = resolveHref(token.href, chapter.file, chapter.chapterId, chapterIdByFile, repoRoot);
    const text = this.parser.parseInline(token.tokens);
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<a href="${escapeHtml(href)}"${title}>${text}</a>`;
  };

  renderer.image = function image(token) {
    const src = resolveImage(token.href, chapter.file, repoRoot);
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<img class="doc-image" src="${escapeHtml(src)}" alt="${escapeHtml(token.text || "")}"${title} />`;
  };

  renderer.code = function code(token) {
    const language = token.lang ? slugify(token.lang) : "";
    const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";

    if (language === "mermaid") {
      return `<pre class="mermaid-block"><code>${escapeHtml(token.text)}</code></pre>`;
    }

    return `<pre><code${classAttr}>${escapeHtml(token.text)}</code></pre>`;
  };

  return renderer;
}

export function chapterHtml(chapter, chapterIdByFile, repoRoot) {
  const renderer = createRenderer(chapter, chapterIdByFile, repoRoot);
  const bodyHtml = marked.parse(stripLeadingTitle(chapter.markdown), {
    gfm: true,
    renderer,
  });

  return `
    <section class="chapter" id="${escapeHtml(chapter.chapterId)}">
      <div class="chapter-meta">
        <span>Chapter ${chapter.number}</span>
        <span>${escapeHtml(chapter.partTitle)}</span>
        <span>${escapeHtml(displayPath(chapter.file))}</span>
      </div>
      <h1 class="chapter-title">${escapeHtml(chapter.title)}</h1>
      ${bodyHtml}
    </section>
  `;
}

export function tocHtml(chapters) {
  return parts
    .map((part) => {
      const partChapters = chapters.filter((chapter) => chapter.partTitle === part.title);
      const items = partChapters
        .map(
          (chapter) => `
            <li>
              <a href="#${escapeHtml(chapter.chapterId)}">Chapter ${chapter.number}. ${escapeHtml(chapter.title)}</a>
              <span>${escapeHtml(displayPath(chapter.file))}</span>
            </li>
          `,
        )
        .join("");

      return `
        <section class="toc-part">
          <h2>${escapeHtml(part.title)}</h2>
          <p>${escapeHtml(part.intro)}</p>
          <ol>${items}</ol>
        </section>
      `;
    })
    .join("");
}

export function partBreakHtml(part, partNumber) {
  return `
    <section class="part-break" id="part-${partNumber}">
      <p class="part-label">Part ${partNumber}</p>
      <h1>${escapeHtml(part.title.replace(/^Part\s+[IVXLC]+\.\s+/i, ""))}</h1>
      <p>${escapeHtml(part.intro)}</p>
    </section>
  `;
}

export const BOOK_CSS = `
      @page {
        size: A4;
        margin: 18mm 14mm 18mm 14mm;
      }

      :root {
        color-scheme: light;
        --ink: #142033;
        --muted: #56657d;
        --paper: #fffdfa;
        --panel: #f3ede1;
        --accent: #b46d2a;
        --border: #d9cdb8;
        --code: #0c1422;
        --code-paper: #eef2f7;
      }

      * {
        box-sizing: border-box;
      }

      html {
        font-size: 11pt;
      }

      body {
        margin: 0;
        color: var(--ink);
        background: var(--paper);
        font-family: Georgia, "Times New Roman", serif;
        line-height: 1.55;
      }

      h1, h2, h3, h4, h5, h6 {
        color: #0b1628;
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        line-height: 1.2;
        margin: 1.1em 0 0.45em;
        break-after: avoid-page;
      }

      h1 {
        font-size: 2rem;
      }

      h2 {
        font-size: 1.35rem;
        border-top: 1px solid var(--border);
        padding-top: 0.45rem;
      }

      p, li, td, th, blockquote {
        orphans: 3;
        widows: 3;
      }

      a {
        color: #224f9c;
        text-decoration: none;
      }

      code, pre {
        font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      }

      p code, li code, td code, th code {
        background: var(--code-paper);
        border-radius: 4px;
        padding: 0.08rem 0.28rem;
        font-size: 0.92em;
      }

      pre {
        background: var(--code);
        color: #edf3ff;
        border-radius: 10px;
        overflow: hidden;
        padding: 0.9rem 1rem;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .mermaid-block {
        background: #f7f2e8;
        color: var(--ink);
        border: 1px dashed var(--border);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 1rem 0 1.25rem;
        font-size: 0.96rem;
      }

      th, td {
        border: 1px solid var(--border);
        padding: 0.45rem 0.55rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #f6efe3;
      }

      blockquote {
        margin: 1rem 0;
        padding: 0.1rem 0 0.1rem 1rem;
        border-left: 3px solid var(--accent);
        color: #354154;
      }

      hr {
        border: 0;
        border-top: 1px solid var(--border);
        margin: 1.4rem 0;
      }

      .cover,
      .toc,
      .part-break,
      .appendix-section,
      .chapter {
        break-before: page;
      }

      .cover {
        break-before: auto;
        min-height: 250mm;
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 1.25rem;
        align-items: start;
        padding: 6mm 0;
      }

      .cover-panel {
        background:
          linear-gradient(160deg, rgba(20, 32, 51, 0.96), rgba(18, 52, 89, 0.92)),
          radial-gradient(circle at top right, rgba(255, 197, 106, 0.2), transparent 40%);
        color: #f6f5f1;
        border-radius: 20px;
        padding: 1.5rem;
        min-height: 100%;
      }

      .cover-panel h1,
      .cover-panel h2,
      .cover-panel p {
        color: inherit;
      }

      .cover-kicker {
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-size: 0.78rem;
        opacity: 0.82;
      }

      .cover h1 {
        font-size: 2.8rem;
        margin-bottom: 0.35rem;
      }

      .cover img {
        width: 100%;
        border-radius: 18px;
        display: block;
        border: 1px solid rgba(20, 32, 51, 0.12);
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
        margin-top: 1.25rem;
      }

      .stat {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 0.85rem 0.9rem;
      }

      .stat strong {
        display: block;
        font-size: 0.9rem;
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .stat span {
        display: block;
        margin-top: 0.35rem;
        font-size: 1.1rem;
      }

      .toc h1 {
        margin-top: 0;
      }

      .toc-part {
        margin-bottom: 1.2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--border);
      }

      .toc-part ol {
        margin: 0.5rem 0 0;
        padding-left: 1.25rem;
      }

      .toc-part li {
        margin-bottom: 0.35rem;
      }

      .toc-part li span {
        display: block;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .intro-note {
        break-before: page;
        background: linear-gradient(180deg, #faf5ea, #fffdfa);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 1.3rem 1.4rem;
      }

      .intro-note ul {
        margin-bottom: 0;
      }

      .part-break {
        min-height: 220mm;
        display: grid;
        align-content: center;
        justify-items: start;
        padding: 10mm 0;
      }

      .part-label {
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--accent);
        font-size: 0.78rem;
        margin-bottom: 0.8rem;
      }

      .part-break h1 {
        font-size: 2.6rem;
        margin: 0 0 0.6rem;
      }

      .part-break p {
        max-width: 32rem;
        font-size: 1.1rem;
        color: #334055;
      }

      .chapter-meta {
        display: flex;
        gap: 0.65rem;
        flex-wrap: wrap;
        margin-bottom: 0.7rem;
        color: var(--muted);
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .chapter-meta span {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.2rem 0.5rem;
      }

      .chapter-title {
        margin-top: 0;
      }

      .doc-image {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 0.85rem auto;
        border-radius: 10px;
      }

      .full-figure {
        margin: 1rem 0 0;
      }

      .full-figure figcaption {
        color: var(--muted);
        font-size: 0.9rem;
        text-align: center;
      }

      .gallery-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }

      .gallery-item {
        break-inside: avoid;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 0.55rem;
        background: #fcfaf6;
      }

      .gallery-item figcaption {
        text-align: center;
        color: #334055;
        font-size: 0.9rem;
      }

      .gallery-item span {
        color: var(--muted);
        font-size: 0.8rem;
      }

      .appendix-note {
        min-height: 220mm;
        display: grid;
        align-content: center;
      }

      .source-note {
        color: var(--muted);
        font-size: 0.9rem;
      }
`;
