// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installPwaInstallPrompt,
  recordLocalAiMatchCompleted,
} from './pwa-install';

const installFixture = () => {
  document.body.innerHTML = `
    <div id="pwaInstallPrompt" hidden>
      <button id="pwaInstallBtn" type="button">Install</button>
      <button id="pwaInstallDismissBtn" type="button">Not now</button>
    </div>
  `;
};

const createBeforeInstallPromptEvent = (
  outcome: 'accepted' | 'dismissed' = 'accepted',
) => {
  const event = new Event('beforeinstallprompt', {
    cancelable: true,
  }) as Event & {
    prompt: ReturnType<typeof vi.fn<() => Promise<void>>>;
    userChoice: Promise<{
      outcome: 'accepted' | 'dismissed';
      platform: string;
    }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
};

describe('pwa install prompt', () => {
  beforeEach(() => {
    installFixture();
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('shows after an AI match completes and the browser offers install', () => {
    const dispose = installPwaInstallPrompt({ storage: window.localStorage });
    const promptEvent = createBeforeInstallPromptEvent();
    const prompt = document.getElementById('pwaInstallPrompt') as HTMLElement;

    window.dispatchEvent(promptEvent);
    expect(prompt.hidden).toBe(true);

    recordLocalAiMatchCompleted(window.localStorage);
    expect(prompt.hidden).toBe(false);
    expect(promptEvent.defaultPrevented).toBe(true);

    dispose();
  });

  it('launches the deferred prompt and stores accepted installs', async () => {
    const dispose = installPwaInstallPrompt({ storage: window.localStorage });
    const promptEvent = createBeforeInstallPromptEvent('accepted');
    const installBtn = document.getElementById(
      'pwaInstallBtn',
    ) as HTMLButtonElement;

    window.dispatchEvent(promptEvent);
    recordLocalAiMatchCompleted(window.localStorage);
    installBtn.click();
    await promptEvent.userChoice;
    await Promise.resolve();

    expect(promptEvent.prompt).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('delta-v-pwa-install-accepted')).toBe(
      '1',
    );

    dispose();
  });

  it('keeps the prompt hidden after a dismiss action', () => {
    const dispose = installPwaInstallPrompt({ storage: window.localStorage });
    const dismissBtn = document.getElementById(
      'pwaInstallDismissBtn',
    ) as HTMLButtonElement;
    const prompt = document.getElementById('pwaInstallPrompt') as HTMLElement;

    window.dispatchEvent(createBeforeInstallPromptEvent());
    recordLocalAiMatchCompleted(window.localStorage);
    expect(prompt.hidden).toBe(false);

    dismissBtn.click();
    expect(prompt.hidden).toBe(true);

    window.dispatchEvent(createBeforeInstallPromptEvent());
    recordLocalAiMatchCompleted(window.localStorage);
    expect(prompt.hidden).toBe(true);

    dispose();
  });
});
