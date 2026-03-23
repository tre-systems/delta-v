import { expect, test, type Page } from '@playwright/test';

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

    for (const page of [host, guest]) {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    }

    await host.click('#createBtn');
    await host.click('[data-scenario="biplanetary"]');
    await waitForDisplay(host, '#waiting', 'flex');

    const roomCode = (await host.locator('#gameCode').textContent())?.trim() ?? '';
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

    await guest.fill('#codeInput', roomCode);
    await guest.click('#joinBtn');

    await waitForDisplay(host, '#hud', 'block');
    await waitForDisplay(guest, '#hud', 'block');

    await expect
      .poll(async () => displayOf(host, '#chatInputRow'))
      .not.toBe('none');
    await expect
      .poll(async () => displayOf(guest, '#chatInputRow'))
      .not.toBe('none');
    await expect(host.locator('#objective')).toContainText('Land on');
    await expect(guest.locator('#objective')).toContainText('Land on');

    await host.close();
    await guest.close();
  });
});
