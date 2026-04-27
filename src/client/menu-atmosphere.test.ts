// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { installMenuAtmosphere } from './menu-atmosphere';

const createStorage = (initial: Record<string, string> = {}): Storage => {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
};

describe('menu atmosphere', () => {
  it('adds the logo entrance class once per session', () => {
    document.body.innerHTML = '<img class="menu-logo" alt="">';
    const storage = createStorage();

    installMenuAtmosphere({ storage });

    expect(document.querySelector('.menu-logo')?.className).toContain(
      'menu-logo-enter',
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      'delta-v-menu-logo-animated',
      '1',
    );

    document.querySelector('.menu-logo')?.classList.remove('menu-logo-enter');
    installMenuAtmosphere({ storage });

    expect(document.querySelector('.menu-logo')?.className).not.toContain(
      'menu-logo-enter',
    );
  });

  it('still animates when session storage is unavailable', () => {
    document.body.innerHTML = '<img class="menu-logo" alt="">';
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(),
    } as unknown as Storage;

    installMenuAtmosphere({ storage });

    expect(document.querySelector('.menu-logo')?.className).toContain(
      'menu-logo-enter',
    );
  });
});
