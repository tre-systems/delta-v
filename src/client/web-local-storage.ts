/**
 * Returns `localStorage` when it is a real Storage implementation.
 * Private mode, SSR, and some test globals can throw or expose invalid objects.
 */
export const getWebLocalStorage = (): Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
> | null => {
  try {
    const g = globalThis as typeof globalThis & {
      localStorage?: unknown;
      window?: { localStorage?: unknown };
    };
    const candidates = [g.localStorage, g.window?.localStorage];
    for (const ls of candidates) {
      if (
        ls !== null &&
        ls !== undefined &&
        typeof ls === 'object' &&
        typeof (ls as Storage).getItem === 'function' &&
        typeof (ls as Storage).setItem === 'function' &&
        typeof (ls as Storage).removeItem === 'function'
      ) {
        return ls as Storage;
      }
    }
  } catch {
    /* private mode / no storage */
  }
  return null;
};
