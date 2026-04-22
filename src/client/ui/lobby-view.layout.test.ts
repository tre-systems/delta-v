// @vitest-environment jsdom
// Pins the home-screen layout in static/index.html so a future edit
// cannot silently revert the create-private-match position or reintroduce
// the difficulty-tier-note / difficulty-hint copy.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(
  join(process.cwd(), 'static/index.html'),
  'utf8',
);

const parseMenu = (): Element => {
  const dom = new DOMParser().parseFromString(indexHtml, 'text/html');
  const menu = dom.querySelector('#menu');
  if (!menu) throw new Error('static/index.html is missing #menu');
  return menu;
};

const indexOfDescendant = (root: Element, selector: string): number => {
  const target = root.querySelector(selector);
  if (!target) return -1;
  const all = Array.from(root.querySelectorAll('*'));
  return all.indexOf(target);
};

describe('home menu layout', () => {
  it('orders Quick Match → Leaderboard → Create Private → Join code input', () => {
    const menu = parseMenu();
    const quickMatch = indexOfDescendant(menu, '#quickMatchBtn');
    const leaderboard = indexOfDescendant(menu, 'a[href="/leaderboard"]');
    const matches = indexOfDescendant(menu, 'a[href="/matches"]');
    const createBtn = indexOfDescendant(menu, '#createBtn');
    const codeInput = indexOfDescendant(menu, '#codeInput');
    const joinBtn = indexOfDescendant(menu, '#joinBtn');

    expect(quickMatch).toBeGreaterThan(-1);
    expect(leaderboard).toBeGreaterThan(quickMatch);
    expect(matches).toBeGreaterThan(leaderboard);
    expect(createBtn).toBeGreaterThan(matches);
    expect(codeInput).toBeGreaterThan(createBtn);
    expect(joinBtn).toBeGreaterThan(codeInput);
  });

  it('pairs Create Private Match with the Join form in a single surface', () => {
    const menu = parseMenu();
    const surface = menu.querySelector('.menu-surface-friends');
    expect(surface).not.toBeNull();
    expect(surface?.querySelector('#createBtn')).not.toBeNull();
    expect(surface?.querySelector('#codeInput')).not.toBeNull();
    expect(surface?.querySelector('#joinBtn')).not.toBeNull();
  });

  it('does not bury the join form in a <details> disclosure', () => {
    const menu = parseMenu();
    // The old markup wrapped the join input in <details class="menu-disclosure">.
    // Assert there is no details wrapper around the codeInput anymore so the
    // join form is reachable in one tab stop from Create Private Match.
    const codeInput = menu.querySelector('#codeInput');
    expect(codeInput?.closest('details')).toBeNull();
  });

  it('renders exactly three difficulty buttons with plain Easy/Normal/Hard labels', () => {
    const menu = parseMenu();
    const buttons = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('.btn-difficulty'),
    );
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Easy',
      'Normal',
      'Hard',
    ]);
  });

  it('has no difficulty-tier-note or difficulty-hint copy', () => {
    const menu = parseMenu();
    expect(menu.querySelector('.difficulty-tier-note')).toBeNull();
    expect(menu.querySelector('.difficulty-hint')).toBeNull();
    expect(menu.querySelector('#difficultyHint')).toBeNull();
  });
});
