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
  timeout?: number,
): Promise<void> => {
  await expect
    .poll(async () => displayOf(page, selector), { timeout })
    .toBe(expectedDisplay);
};

const skipTutorialIfPresent = async (page: Page): Promise<void> => {
  const skip = page.locator('#tutorialSkipBtn');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
};

const launchVsAI = async (page: Page, scenario: string): Promise<void> => {
  await page.addInitScript(() => {
    window.localStorage.setItem('deltav_tutorial_done', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.click('#singlePlayerBtn');
  await page.click(`[data-scenario="${scenario}"]`);
  await waitForDisplay(page, '#hud', 'block');
  await skipTutorialIfPresent(page);
};

test.describe('manual test plan coverage', () => {
  test('hides inactive screens from the accessibility tree while in HUD', async ({
    page,
  }) => {
    await launchVsAI(page, 'biplanetary');

    await expect(page.locator('#menu')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#scenarioSelect')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.locator('#waiting')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.locator('#fleetBuilding')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.locator('#helpOverlay')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  test('Grand Tour shows checkpoint race objective', async ({ page }) => {
    await launchVsAI(page, 'grandTour');

    await expect(page.locator('#objective')).toContainText('Tour:');
    await expect(page.locator('#objective')).toContainText('/8');
  });

  test('Duel vs AI boots with combat objective', async ({ page }) => {
    await launchVsAI(page, 'duel');

    await expect(page.locator('#objective')).toBeVisible();
    await expect(page.locator('#phaseInfo')).toContainText('ASTROGATION');
  });

  test('Convoy vs AI boots into astrogation', async ({ page }) => {
    await launchVsAI(page, 'convoy');

    await expect(page.locator('#objective')).toBeVisible();
    await expect(page.locator('#phaseInfo')).toContainText('ASTROGATION');
    await expect(page.locator('#shipList .ship-entry')).toHaveCount(2);
  });

  test('Escape vs AI boots with multiple pilgrim ships', async ({ page }) => {
    await launchVsAI(page, 'escape');

    await expect(page.locator('#objective')).toBeVisible();
    const ships = page.locator('#shipList .ship-entry');
    await expect(ships).toHaveCount(3);
  });

  test('Blockade Runner vs AI boots with the runner packet', async ({
    page,
  }) => {
    await launchVsAI(page, 'blockade');

    await expect(page.locator('#objective')).toBeVisible();
    await expect(page.locator('#shipList .ship-entry')).toHaveCount(1);
  });

  test('Fleet Action vs AI completes fleet pick and reaches HUD', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('deltav_tutorial_done', '1');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.click('#singlePlayerBtn');
    await page.click('[data-scenario="fleetAction"]');

    await waitForDisplay(page, '#fleetBuilding', 'flex');
    await page
      .locator('.fleet-shop-item:not(.disabled)')
      .filter({ hasText: 'Corvette' })
      .first()
      .click();
    await page.click('#fleetReadyBtn');

    await waitForDisplay(page, '#hud', 'block', 30_000);
    await skipTutorialIfPresent(page);

    await expect(page.locator('#phaseInfo')).toContainText('ASTROGATION');
    await expect(page.locator('#shipList .ship-entry').first()).toBeVisible();
  });

  test('help overlay can be opened and closed', async ({ page }) => {
    await launchVsAI(page, 'biplanetary');

    await page.click('#helpBtn');
    await waitForDisplay(page, '#helpOverlay', 'flex');
    await expect(page.locator('#helpOverlay')).not.toHaveAttribute(
      'aria-hidden',
      'true',
    );

    await page.click('#helpCloseBtn');
    await waitForDisplay(page, '#helpOverlay', 'none');
    await expect(page.locator('#helpOverlay')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
