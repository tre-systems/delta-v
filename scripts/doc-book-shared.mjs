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
      "Operational guidance for testing, accessibility, observability, security, privacy, and coordinated releases.",
    files: [
      "docs/SIMULATION_TESTING.md",
      "docs/MANUAL_TEST_PLAN.md",
      "docs/A11Y.md",
      "docs/OBSERVABILITY.md",
      "docs/SECURITY.md",
      "docs/PRIVACY_TECHNICAL.md",
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
    title: "Part VI. Operational Annexes and Current State",
    intro:
      "These chapters are deliberately more volatile than the core handbook: exploratory methods, recurring review checklists, and the live backlog snapshot.",
    files: [
      "docs/REVIEW_PLAN.md",
      "docs/EXPLORATORY_TESTING.md",
      "docs/BACKLOG.md",
    ],
  },
];

export const chapterMetadata = {
  "README.md": {
    abstract:
      "A compact product-and-repository overview: what Delta-V is, how the codebase is laid out, and which documents matter first.",
    mode: "Orientation",
    audience: "New contributors and reviewers",
  },
  "docs/CONTRIBUTING.md": {
    abstract:
      "The working agreement for local development: hooks, verification commands, and the minimum workflow expected before changes are pushed.",
    mode: "Contributor reference",
    audience: "Anyone making code or doc changes",
  },
  "docs/ARCHITECTURE.md": {
    abstract:
      "The system map of the project: shared engine, server authority, client orchestration, persistence, and the major runtime boundaries.",
    mode: "Architecture reference",
    audience: "Engineers changing system shape",
  },
  "docs/CODING_STANDARDS.md": {
    abstract:
      "The conventions that keep the repository coherent: side-effect boundaries, refactoring guidance, testing expectations, and code-structure rules.",
    mode: "Engineering policy",
    audience: "Anyone editing production code",
  },
  "patterns/README.md": {
    abstract:
      "A guide to the pattern chapters and the questions each one answers, intended as the entry page for the design catalogue.",
    mode: "Guide",
    audience: "Readers learning the codebase shape",
  },
  "patterns/engine-and-architecture.md": {
    abstract:
      "Explains the core architectural choices: functional engine boundaries, event flow, replayability, and imperative shell design.",
    mode: "Pattern rationale",
    audience: "Engineers working across layers",
  },
  "patterns/protocol-and-persistence.md": {
    abstract:
      "Describes how Delta-V stores, validates, replays, and projects match data across protocol, archive, and recovery paths.",
    mode: "Pattern rationale",
    audience: "Engineers touching protocol or storage",
  },
  "patterns/client.md": {
    abstract:
      "A walkthrough of client-side state ownership, orchestration, and rendering patterns without relying on a heavyweight UI framework.",
    mode: "Pattern rationale",
    audience: "Client and UI contributors",
  },
  "patterns/type-system-and-validation.md": {
    abstract:
      "Covers the defensive type-and-validation techniques that keep malformed data out of the engine and the network boundary.",
    mode: "Pattern rationale",
    audience: "Protocol, server, and engine contributors",
  },
  "patterns/scenarios-and-config.md": {
    abstract:
      "Shows how scenario definitions, AI tuning, and configuration registries are expressed declaratively instead of procedurally.",
    mode: "Pattern rationale",
    audience: "Scenario, AI, and rules contributors",
  },
  "patterns/testing.md": {
    abstract:
      "Explains how the test suite is layered, where different kinds of tests belong, and why the project emphasizes deterministic harnesses.",
    mode: "Pattern rationale",
    audience: "Anyone adding or reviewing tests",
  },
  "docs/PROTOCOL.md": {
    abstract:
      "The canonical wire and state contract: message types, payload shapes, routes, identifiers, and compatibility assumptions.",
    mode: "Normative reference",
    audience: "Protocol, client, server, and agent implementers",
  },
  "docs/SPEC.md": {
    abstract:
      "The definitive rules of play and scenario definitions: phases, movement, combat, logistics, victory conditions, and scenario-specific rules.",
    mode: "Normative reference",
    audience: "Rules, engine, and QA readers",
  },
  "docs/LORE.md": {
    abstract:
      "The visual and tonal brief for ships, factions, and the aesthetic language of the setting.",
    mode: "Art-direction reference",
    audience: "Designers and art-direction readers",
  },
  "docs/SIMULATION_TESTING.md": {
    abstract:
      "How the project uses headless engine sweeps, load harnesses, and agent bridges to test behavior beyond ordinary unit coverage.",
    mode: "Operational guide",
    audience: "QA, AI, and release contributors",
  },
  "docs/MANUAL_TEST_PLAN.md": {
    abstract:
      "The hands-on release checklist for verifying shipped behavior across scenarios, UI surfaces, inputs, multiplayer, and recovery paths.",
    mode: "Operational checklist",
    audience: "Release and QA readers",
  },
  "docs/A11Y.md": {
    abstract:
      "The accessibility audit guide for the DOM-facing surfaces around the canvas game board, including scope and review cadence.",
    mode: "Operational checklist",
    audience: "UI and accessibility reviewers",
  },
  "docs/OBSERVABILITY.md": {
    abstract:
      "The implementation-level map of telemetry, logs, D1 tables, and triage queries used to understand incidents and runtime behavior.",
    mode: "Operational reference",
    audience: "Operators and server engineers",
  },
  "docs/SECURITY.md": {
    abstract:
      "A practical security and competitive-integrity review of the current product, including rate limits, trust boundaries, and token flows.",
    mode: "Security reference",
    audience: "Operators, reviewers, and server engineers",
  },
  "docs/PRIVACY_TECHNICAL.md": {
    abstract:
      "The technical record of what user and telemetry data is stored, where it lives, and how long the system keeps it.",
    mode: "Operational reference",
    audience: "Operators and privacy reviewers",
  },
  "docs/COORDINATED_RELEASE_CHECKLIST.md": {
    abstract:
      "The coordination checklist for schema, protocol, replay, and migration changes that must move together in one release line.",
    mode: "Operational checklist",
    audience: "Release owners",
  },
  "docs/AGENTS.md": {
    abstract:
      "The shortest practical path to a working Delta-V agent, from integration choice to quick-start loops and tuning workflow.",
    mode: "Integration guide",
    audience: "Agent builders",
  },
  "docs/DELTA_V_MCP.md": {
    abstract:
      "The full MCP transport and tool reference, covering local stdio, hosted HTTP, session models, and JSON-RPC examples.",
    mode: "Normative reference",
    audience: "MCP and tooling integrators",
  },
  "AGENT_SPEC.md": {
    abstract:
      "The deep design reference for machine-native play: observations, actions, discovery metadata, security, and integration paths.",
    mode: "Protocol and product reference",
    audience: "Advanced agent authors and maintainers",
  },
  "docs/REVIEW_PLAN.md": {
    abstract:
      "A recurring review worksheet for cross-cutting audits such as security, observability, release hygiene, and CI friction.",
    mode: "Annex worksheet",
    audience: "Maintainers running periodic audits",
    volatile: true,
  },
  "docs/EXPLORATORY_TESTING.md": {
    abstract:
      "A field manual for discovery-oriented testing: lenses, probe recipes, and pass logging for finding issues that scripted tests miss.",
    mode: "Annex workbook",
    audience: "Reviewers running exploratory passes",
    volatile: true,
  },
  "docs/BACKLOG.md": {
    abstract:
      "A live snapshot of open work, design gaps, and operational follow-ups. Useful, but intentionally more perishable than the rest of the handbook.",
    mode: "Live appendix",
    audience: "Maintainers prioritizing next work",
    volatile: true,
  },
};

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
        meta: chapterMetadata[file] ?? null,
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
  const mode = chapter.meta?.mode ?? "Reference";
  const audience = chapter.meta?.audience ?? "Repository readers";
  const abstract = chapter.meta?.abstract ?? "";
  const volatilityNote = chapter.meta?.volatile
    ? `<p class="chapter-volatility">This chapter is intentionally volatile. Treat it as an annex snapshot rather than a timeless description of the system.</p>`
    : "";

  return `
    <section class="chapter" id="${escapeHtml(chapter.chapterId)}">
      <div class="chapter-kicker">Chapter ${chapter.number}</div>
      <div class="chapter-opener">
        <div class="chapter-meta">
          <span>${escapeHtml(chapter.partTitle)}</span>
          <span>${escapeHtml(mode)}</span>
          <span>${escapeHtml(displayPath(chapter.file))}</span>
        </div>
        <h1 class="chapter-title">${escapeHtml(chapter.title)}</h1>
        <p class="chapter-abstract">${escapeHtml(abstract)}</p>
        <div class="chapter-summary-grid">
          <div>
            <strong>Reading mode</strong>
            <span>${escapeHtml(mode)}</span>
          </div>
          <div>
            <strong>Best for</strong>
            <span>${escapeHtml(audience)}</span>
          </div>
        </div>
        ${volatilityNote}
      </div>
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

export function annexBreakHtml(title, body) {
  return `
    <section class="part-break annex-break">
      <p class="part-label">Annex</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(body)}</p>
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
        margin-bottom: 0.9rem;
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

      .chapter-kicker {
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--accent);
        font-size: 0.78rem;
        margin-bottom: 0.85rem;
      }

      .chapter-opener {
        border: 1px solid var(--border);
        border-radius: 18px;
        background:
          linear-gradient(180deg, rgba(243, 237, 225, 0.9), rgba(255, 253, 250, 1));
        padding: 1.1rem 1.2rem 1rem;
        margin-bottom: 1.4rem;
      }

      .chapter-abstract {
        font-size: 1.05rem;
        color: #243248;
        margin: 0 0 0.95rem;
      }

      .chapter-summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
      }

      .chapter-summary-grid div {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.6);
        padding: 0.7rem 0.8rem;
      }

      .chapter-summary-grid strong {
        display: block;
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.72rem;
        color: var(--muted);
        margin-bottom: 0.3rem;
      }

      .chapter-summary-grid span {
        display: block;
      }

      .chapter-volatility {
        margin: 0.95rem 0 0;
        padding: 0.7rem 0.85rem;
        border-left: 4px solid var(--accent);
        background: #fff7ea;
        color: #4b341d;
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

      .annex-break {
        min-height: 200mm;
      }

      .source-note {
        color: var(--muted);
        font-size: 0.9rem;
      }
`;
