import { getWebLocalStorage } from './web-local-storage';

const COMPLETED_AI_MATCHES_KEY = 'delta-v-pwa-ai-completed-matches';
const INSTALL_DISMISSED_KEY = 'delta-v-pwa-install-dismissed';
const INSTALL_ACCEPTED_KEY = 'delta-v-pwa-install-accepted';

type WebStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

const getCompletedAiMatches = (storage: WebStorage): number => {
  const raw = Number(storage.getItem(COMPLETED_AI_MATCHES_KEY) ?? '0');
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
};

const isStandaloneDisplay = (win: Window): boolean => {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return (
    win.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
};

let activeRefresh: (() => void) | null = null;

export const recordLocalAiMatchCompleted = (
  storage: WebStorage | null = getWebLocalStorage(),
): void => {
  if (!storage) return;

  const nextCount = Math.min(2, getCompletedAiMatches(storage) + 1);
  storage.setItem(COMPLETED_AI_MATCHES_KEY, String(nextCount));
  activeRefresh?.();
};

export const installPwaInstallPrompt = (
  opts: { win?: Window; doc?: Document; storage?: WebStorage | null } = {},
): (() => void) => {
  const win = opts.win ?? window;
  const doc = opts.doc ?? document;
  const storage = opts.storage ?? getWebLocalStorage();
  const panel = doc.getElementById('pwaInstallPrompt') as HTMLElement | null;
  const installBtn = doc.getElementById(
    'pwaInstallBtn',
  ) as HTMLButtonElement | null;
  const dismissBtn = doc.getElementById(
    'pwaInstallDismissBtn',
  ) as HTMLButtonElement | null;
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  const hide = (): void => {
    if (panel) {
      panel.hidden = true;
    }
  };

  const canShow = (): boolean =>
    Boolean(
      panel &&
        installBtn &&
        storage &&
        deferredPrompt &&
        getCompletedAiMatches(storage) > 0 &&
        storage.getItem(INSTALL_DISMISSED_KEY) !== '1' &&
        storage.getItem(INSTALL_ACCEPTED_KEY) !== '1' &&
        !isStandaloneDisplay(win),
    );

  const refresh = (): void => {
    if (!canShow()) {
      hide();
      return;
    }

    if (panel) {
      panel.hidden = false;
    }
  };

  activeRefresh = refresh;

  const onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    refresh();
  };

  const onAppInstalled = (): void => {
    storage?.setItem(INSTALL_ACCEPTED_KEY, '1');
    deferredPrompt = null;
    refresh();
  };

  const onInstallClick = async (): Promise<void> => {
    if (!deferredPrompt || !storage) return;

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    hide();
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    if (choice.outcome === 'accepted') {
      storage.setItem(INSTALL_ACCEPTED_KEY, '1');
    }
  };

  const onDismissClick = (): void => {
    storage?.setItem(INSTALL_DISMISSED_KEY, '1');
    hide();
  };

  win.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  win.addEventListener('appinstalled', onAppInstalled);
  installBtn?.addEventListener('click', onInstallClick);
  dismissBtn?.addEventListener('click', onDismissClick);
  refresh();

  return () => {
    win.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    win.removeEventListener('appinstalled', onAppInstalled);
    installBtn?.removeEventListener('click', onInstallClick);
    dismissBtn?.removeEventListener('click', onDismissClick);
    if (activeRefresh === refresh) {
      activeRefresh = null;
    }
  };
};
