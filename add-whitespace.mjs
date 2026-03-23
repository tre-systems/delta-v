#!/usr/bin/env node

// Adds blank lines between class members and top-level
// declarations where missing. Conservative — better to
// miss spots than add unwanted blank lines.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const srcDir = resolve(import.meta.dirname, 'src');

// Find all non-test .ts files in src/
const files = execSync(
  `find ${srcDir} -name '*.ts' ! -name '*.test.ts'`,
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

// Lines that follow a closing brace and should NOT get
// a blank line inserted before them.
const noBlankAfterBrace = /^\s*(\}|else\b|catch\b|finally\b|\)|]\s*[;,)]?|\)\s*[;,]?|\/\/\s*eslint)/;

// Tokens that start a class member declaration.
const classMemberStart =
  /^\s+(private|public|protected|static|readonly|abstract|override|get\s|set\s|async\s|constructor\b|\*|\/\/|\/\*)/;

// A named method: indented identifier followed by (
// e.g. "  handleFoo(..." or "  async handleFoo(..."
const classMethodLike =
  /^\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*[\(<]/;

// Top-level declaration starters.
const topLevelDecl =
  /^(export\s|const\s|let\s|var\s|type\s|interface\s|class\s|function\s|enum\s|abstract\s|declare\s|\/\/\s*---|\/\*)/;

// A line that is just a closing brace at class-member
// indent level (typically 2 spaces).
const classMemberClose = /^(\s{2})\}$/;

// A line that is a top-level closing brace or };
const topLevelClose = /^(\};?|export\s+\};?)$/;

// Detect if we're inside a string literal context.
// We track template literal nesting with backtick count.
const isInStringContext = (lines, index) => {
  let inTemplate = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < index; i++) {
    const line = lines[i];
    let escaped = false;

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (inSingleQuote) {
        if (ch === "'") inSingleQuote = false;
        continue;
      }

      if (inDoubleQuote) {
        if (ch === '"') inDoubleQuote = false;
        continue;
      }

      if (inTemplate > 0) {
        if (ch === '`') {
          inTemplate--;
        }
        continue;
      }

      if (ch === "'") {
        inSingleQuote = true;
      } else if (ch === '"') {
        inDoubleQuote = true;
      } else if (ch === '`') {
        inTemplate++;
      }
    }
  }

  return inTemplate > 0 || inSingleQuote || inDoubleQuote;
};

// Track brace depth to determine if a } is at class
// member level or top level.
const computeIndent = (line) => {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
};

let totalModified = 0;
const modifiedFiles = [];

for (const filePath of files) {
  const original = readFileSync(filePath, 'utf8');
  const lines = original.split('\n');
  const result = [];
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);

    // Skip if we're at the last line.
    if (i >= lines.length - 1) continue;

    const currentLine = lines[i];
    const nextLine = lines[i + 1];

    // Skip if next line is already blank.
    if (nextLine.trim() === '') continue;

    // Skip if current line is blank.
    if (currentLine.trim() === '') continue;

    // --- Rule 1: Between class members ---
    // Current line is "  }" (class member indent close).
    if (classMemberClose.test(currentLine)) {
      // Check next line is NOT one of the exceptions.
      if (noBlankAfterBrace.test(nextLine)) continue;

      // Check next line starts a class member.
      if (
        classMemberStart.test(nextLine) ||
        classMethodLike.test(nextLine)
      ) {
        result.push('');
        modified = true;
        continue;
      }
    }

    // --- Rule 2: Between top-level declarations ---
    // Current line ends a top-level block.
    if (topLevelClose.test(currentLine)) {
      // Next line starts a new top-level declaration.
      if (topLevelDecl.test(nextLine)) {
        result.push('');
        modified = true;
        continue;
      }
    }

    // Also handle: a line ending with }; or } at indent 0
    // that is not caught by the strict regex (e.g., with
    // trailing comment), followed by a top-level decl.
    if (
      /^\S/.test(currentLine) &&
      /\};?\s*(\/\/.*)?$/.test(currentLine) &&
      topLevelDecl.test(nextLine)
    ) {
      result.push('');
      modified = true;
      continue;
    }

    // Handle: closing of a top-level arrow fn or object
    // (line is just "};") followed by top-level decl.
    if (/^};$/.test(currentLine.trim()) && computeIndent(currentLine) === 0) {
      if (topLevelDecl.test(nextLine)) {
        // Already handled above but just in case
        if (result[result.length - 1] !== '') {
          result.push('');
          modified = true;
        }
        continue;
      }
    }
  }

  const newContent = result.join('\n');

  if (modified) {
    writeFileSync(filePath, newContent, 'utf8');
    totalModified++;
    modifiedFiles.push(filePath.replace(srcDir + '/', ''));
  }
}

console.log(`\nModified ${totalModified} files:\n`);
for (const f of modifiedFiles) {
  console.log(`  ${f}`);
}
console.log('');
