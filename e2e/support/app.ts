import { type Browser, expect, type Page } from '@playwright/test';
import { waitForDisplay } from './ui';

const TUTORIAL_DONE_STORAGE_KEY = 'deltav_tutorial_done';
const SESSION_SEEDED_STORAGE_KEY = '__deltav_e2e_seeded';

type HomePageOptions = {
  tutorialDone?: boolean;
};

type ScenarioLaunchOptions = HomePageOptions & {
  skipTutorial?: boolean;
  timeout?: number;
};

export type MultiplayerSession = {
  host: Page;
  guest: Page;
  roomCode: string;
  close: () => Promise<void>;
};

const seedLocalStorage = async (
  page: Page,
  { tutorialDone = false }: HomePageOptions = {},
): Promise<void> => {
  await page.addInitScript(
    ({ sessionSeededKey, tutorialDoneKey, tutorialDone }) => {
      if (window.sessionStorage.getItem(sessionSeededKey) === '1') {
        return;
      }

      window.sessionStorage.setItem(sessionSeededKey, '1');
      window.localStorage.clear();

      if (tutorialDone) {
        window.localStorage.setItem(tutorialDoneKey, '1');
      }

      // Force human to player 0 so E2E tests get a deterministic side
      (
        window as unknown as Record<string, unknown>
      ).__DELTAV_FORCE_PLAYER_SIDE = 0;
    },
    {
      sessionSeededKey: SESSION_SEEDED_STORAGE_KEY,
      tutorialDoneKey: TUTORIAL_DONE_STORAGE_KEY,
      tutorialDone,
    },
  );
};

export const openHomePage = async (
  page: Page,
  options?: HomePageOptions,
): Promise<void> => {
  await seedLocalStorage(page, options);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForDisplay(page, '[data-testid="menu"]', 'flex');
};

export const skipTutorialIfPresent = async (page: Page): Promise<void> => {
  const skip = page.locator('[data-testid="tutorialSkipBtn"]');

  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
};

export const launchSinglePlayerScenario = async (
  page: Page,
  scenario: string,
  {
    tutorialDone = false,
    skipTutorial = false,
    timeout,
  }: ScenarioLaunchOptions = {},
): Promise<void> => {
  await openHomePage(page, { tutorialDone });
  await page.click('[data-testid="singlePlayerBtn"]');
  await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
  await page.click(`[data-scenario="${scenario}"]`);
  await waitForDisplay(page, '[data-testid="hud"]', 'block', timeout);

  if (skipTutorial) {
    await skipTutorialIfPresent(page);
  }
};

export const launchFleetActionScenario = async (page: Page): Promise<void> => {
  await openHomePage(page, { tutorialDone: true });
  await page.click('[data-testid="singlePlayerBtn"]');
  await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
  await page.click('[data-scenario="fleetAction"]');
  await waitForDisplay(page, '[data-testid="fleetBuilding"]', 'flex');
  await page
    .locator('[data-testid="fleet-shop-item"]:not(.disabled)')
    .filter({ hasText: 'Corvette' })
    .first()
    .click();
  await page.click('[data-testid="fleetReadyBtn"]');
  await waitForDisplay(page, '[data-testid="hud"]', 'block', 30_000);
  await skipTutorialIfPresent(page);
};

export const createRoom = async (
  page: Page,
  scenario = 'biplanetary',
): Promise<string> => {
  await page.click('[data-testid="createBtn"]');
  await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
  await page.click(`[data-scenario="${scenario}"]`);
  await waitForDisplay(page, '[data-testid="waiting"]', 'flex', 10_000);

  const roomCode =
    (await page.locator('[data-testid="gameCode"]').textContent())?.trim() ??
    '';
  expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

  return roomCode;
};

export const joinRoom = async (page: Page, roomCode: string): Promise<void> => {
  await submitRoomJoin(page, roomCode);
  await waitForDisplay(page, '[data-testid="hud"]', 'block');
};

export const submitRoomJoin = async (
  page: Page,
  roomCode: string,
): Promise<void> => {
  await page.fill('[data-testid="codeInput"]', roomCode);
  await page.click('[data-testid="joinBtn"]');
};

export const createMultiplayerSession = async (
  browser: Browser,
  scenario = 'biplanetary',
): Promise<MultiplayerSession> => {
  const host = await browser.newPage();
  const guest = await browser.newPage();

  await Promise.all([
    openHomePage(host, { tutorialDone: true }),
    openHomePage(guest, { tutorialDone: true }),
  ]);

  const roomCode = await createRoom(host, scenario);
  await Promise.all([
    joinRoom(guest, roomCode),
    waitForDisplay(host, '[data-testid="hud"]', 'block'),
  ]);

  return {
    host,
    guest,
    roomCode,
    close: async () => closePages(host, guest),
  };
};

export const expandDesktopLog = async (page: Page): Promise<void> => {
  await skipTutorialIfPresent(page);
  const logAlreadyVisible = await page
    .locator('[data-testid="gameLog"]')
    .evaluate((el) => getComputedStyle(el).display !== 'none');
  if (!logAlreadyVisible) {
    await page.click('[data-testid="logLatestBar"]');
  }
  await waitForDisplay(page, '[data-testid="gameLog"]', 'flex');
};

export const openHelpOverlay = async (page: Page): Promise<void> => {
  await page.click('[data-testid="helpBtn"]');
  await waitForDisplay(page, '[data-testid="helpOverlay"]', 'flex');
};

export const closePages = async (...pages: Page[]): Promise<void> => {
  for (const page of pages) {
    if (!page.isClosed()) {
      await page.close();
    }
  }
};
