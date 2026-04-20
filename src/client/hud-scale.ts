import { getWebLocalStorage } from './web-local-storage';

type HudScale = 'small' | 'default' | 'large';

const STORAGE_KEY = 'deltav_hud_scale';
const ORDER: readonly HudScale[] = ['small', 'default', 'large'];

const parseScale = (raw: string | null): HudScale => {
  if (raw === 'small' || raw === 'large') return raw;
  return 'default';
};

const apply = (scale: HudScale): void => {
  document.documentElement.dataset.hudScale = scale;
};

export const installHudScaleShortcuts = (): void => {
  const ls = getWebLocalStorage();
  let current = parseScale(ls?.getItem(STORAGE_KEY) ?? null);
  apply(current);

  const step = (delta: -1 | 1): void => {
    const index = ORDER.indexOf(current);
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, index + delta))];
    if (next === current) return;
    current = next;
    apply(current);
    ls?.setItem(STORAGE_KEY, current);
  };

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+') {
      step(1);
      event.preventDefault();
    } else if (event.key === '_') {
      step(-1);
      event.preventDefault();
    }
  });
};
