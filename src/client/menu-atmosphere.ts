const LOGO_ANIMATED_KEY = 'delta-v-menu-logo-animated';

type MenuAtmosphereDeps = {
  documentRef?: Pick<Document, 'querySelector'>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
};

export const installMenuAtmosphere = ({
  documentRef = document,
  storage = sessionStorage,
}: MenuAtmosphereDeps = {}): void => {
  const logo = documentRef.querySelector<HTMLElement>('.menu-logo');
  if (!logo) return;

  try {
    if (storage.getItem(LOGO_ANIMATED_KEY) === '1') {
      return;
    }
    storage.setItem(LOGO_ANIMATED_KEY, '1');
  } catch {
    // Storage can be blocked in hardened browser modes; the animation is
    // decorative, so falling back to a per-load entrance is acceptable.
  }

  logo.classList.add('menu-logo-enter');
};
