import { expect, type Page, test } from '@playwright/test';

const displayOf = async (page: Page, selector: string): Promise<string> => {
  return page.locator(selector).evaluate((element) => {
    return window.getComputedStyle(element).display;
  });
};

const waitForDisplay = async (
  page: Page,
  selector: string,
  expectedDisplay: string,
): Promise<void> => {
  await expect
    .poll(async () => displayOf(page, selector))
    .toBe(expectedDisplay);
};

const launchSinglePlayer = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.click('#singlePlayerBtn');
  await page.click('[data-scenario="biplanetary"]');
  await waitForDisplay(page, '#hud', 'block');
};

const createMultiplayerRoom = async (
  host: Page,
  guest: Page,
): Promise<string> => {
  for (const page of [host, guest]) {
    await page.addInitScript(() => {
      window.localStorage.setItem('deltav_tutorial_done', '1');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  await host.click('#createBtn');
  await host.click('[data-scenario="biplanetary"]');
  await waitForDisplay(host, '#waiting', 'flex');

  const roomCode =
    (await host.locator('#gameCode').textContent())?.trim() ?? '';
  expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

  await guest.fill('#codeInput', roomCode);
  await guest.click('#joinBtn');

  await waitForDisplay(host, '#hud', 'block');
  await waitForDisplay(guest, '#hud', 'block');

  return roomCode;
};

const expandDesktopLog = async (page: Page): Promise<void> => {
  const tutorialSkip = page.locator('#tutorialSkipBtn');

  if (await tutorialSkip.isVisible().catch(() => false)) {
    await tutorialSkip.click();
  }
  await page.click('#logLatestBar');
  await waitForDisplay(page, '#gameLog', 'flex');
};

test.describe('browser smoke tests', () => {
  test('boots the menu and launches a single-player match', async ({
    page,
  }) => {
    await launchSinglePlayer(page);

    await expect(page).toHaveTitle('Delta-V');
    await expect(page.locator('#objective')).toContainText('Land on');
    await expect(page.locator('#logLatestText')).toContainText('take off');
    await expect(page.locator('#shipList .ship-entry')).toHaveCount(1);
    await expect(page.locator('#helpBtn')).toBeVisible();
    await expect(page.locator('#tutorialTip')).toBeVisible();
  });

  test('can select a ship, queue a burn, and confirm the first turn', async ({
    page,
  }) => {
    await launchSinglePlayer(page);

    await page.click('#shipList .ship-entry');
    await page.keyboard.press('1');
    await expect(page.locator('#logLatestText')).toContainText('Burn set');

    await page.click('#confirmBtn');

    await expect
      .poll(async () => page.locator('#phaseInfo').textContent())
      .toContain("OPPONENT'S TURN");
    await expect(page.locator('#fuelGauge')).toContainText('19/20');
  });

  test('renders the touch-oriented HUD and help overlay in a mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await launchSinglePlayer(page);

    await waitForDisplay(page, '#logLatestBar', 'block');
    await expect(page.locator('#chatInputRow')).toBeHidden();

    await page.click('#helpBtn');
    await waitForDisplay(page, '#helpOverlay', 'flex');
    await expect(page.locator('#helpOverlay')).toContainText('Tap ship');
    await expect(page.locator('#helpOverlay')).toContainText('Tap arrow');
  });

  test('creates and joins a multiplayer room in two browser pages', async ({
    browser,
  }) => {
    const host = await browser.newPage();
    const guest = await browser.newPage();

    await createMultiplayerRoom(host, guest);

    await expect(host.locator('#objective')).toContainText('Land on');
    await expect(guest.locator('#objective')).toContainText('Land on');

    await host.close();
    await guest.close();
  });

  test('delivers chat messages between multiplayer players', async ({
    browser,
  }) => {
    const host = await browser.newPage();
    const guest = await browser.newPage();

    await createMultiplayerRoom(host, guest);
    await expandDesktopLog(host);
    await expandDesktopLog(guest);

    await host.locator('#chatInput').fill('hello from host');
    await host.locator('#chatInput').press('Enter');

    await expect(guest.locator('#logEntries')).toContainText(
      'Opponent: hello from host',
    );

    await host.close();
    await guest.close();
  });

  test('reconnects a joined player after a full page refresh', async ({
    browser,
  }) => {
    const host = await browser.newPage();
    const guest = await browser.newPage();

    await createMultiplayerRoom(host, guest);

    await guest.reload({ waitUntil: 'domcontentloaded' });
    await waitForDisplay(guest, '#hud', 'block');
    await expect(guest.locator('#objective')).toContainText('Land on');
    await expect(guest.locator('#reconnectOverlay')).toBeHidden();

    await host.close();
    await guest.close();
  });

  test('rejects a third player from joining a full room', async ({
    browser,
  }) => {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    const intruder = await browser.newPage();

    const roomCode = await createMultiplayerRoom(host, guest);

    await intruder.goto('/', { waitUntil: 'domcontentloaded' });
    await intruder.fill('#codeInput', roomCode);
    await intruder.click('#joinBtn');

    await expect(intruder.locator('#toastContainer')).toContainText(
      'Game is full',
    );
    await waitForDisplay(intruder, '#menu', 'flex');

    await host.close();
    await guest.close();
    await intruder.close();
  });
});
