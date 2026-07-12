import { expect, test } from '@playwright/test';
import {
  dismissScenarioBriefingIfPresent,
  launchSinglePlayerScenario,
  openHelpOverlay,
  openHomePage,
} from './support/app';
import { waitForDisplay } from './support/ui';

test.describe('single-player smoke tests', () => {
  test('boots the menu and launches a single-player match', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');

    await expect(page).toHaveTitle('Delta-V — Real-time tactical space combat');
    await expect(page.locator('[data-testid="objective"]')).toContainText(
      'Land on',
    );
    await expect(page.locator('[data-testid="logLatestText"]')).toContainText(
      'burn (1 fuel)',
    );
    await expect(page.locator('[data-testid="ship-entry"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="helpBtn"]')).toBeVisible();
    await expect(page.locator('[data-testid="tutorialTip"]')).toBeVisible();
  });

  test('first-run tutorial can be skipped from the HUD', async ({ page }) => {
    await launchSinglePlayerScenario(page, 'biplanetary', {
      tutorialDone: false,
    });
    await expect(page.locator('[data-testid="tutorialTip"]')).toBeVisible();
    await page.click('[data-testid="tutorialSkipBtn"]');
    await waitForDisplay(page, '[data-testid="tutorialTip"]', 'none');
  });

  test('Training Flight resets guidance and explains the plotted course', async ({
    page,
  }) => {
    await openHomePage(page, { tutorialDone: true });
    await page.click('[data-testid="singlePlayerBtn"]');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');

    await expect(page.locator('[data-training-flight="true"]')).toContainText(
      'Recommended first mission',
    );
    await expect(page.locator('.scenario-group-title')).toHaveText([
      'Start Here',
      'Learn Combat',
      'Advanced Missions',
      'Fleet Command',
    ]);

    await page.click('[data-training-flight="true"]');
    await waitForDisplay(page, '[data-testid="hud"]', 'block');
    await dismissScenarioBriefingIfPresent(page);

    await expect(page.locator('[data-testid="tutorialTip"]')).toBeVisible();
    await expect(page.locator('[data-testid="tutorialTip"]')).toContainText(
      'Choose a numbered burn circle',
    );
    await expect(page.locator('[data-testid="fuelGauge"]')).toContainText(
      'Stay landed · 0 fuel',
    );
    await expect(page.locator('[data-testid="confirmBtn"]')).toContainText(
      'STAY LANDED',
    );

    await page.keyboard.press('1');
    await expect(page.locator('[data-testid="fuelGauge"]')).toContainText(
      'Burn · −1 fuel · next speed 1',
    );
    await expect(page.locator('[data-testid="confirmBtn"]')).toContainText(
      'CONFIRM COURSE',
    );
  });

  test('can select a ship, queue a burn, and confirm the first turn', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');

    await page.click('[data-testid="ship-entry"]');
    await page.keyboard.press('1');
    await expect(page.locator('[data-testid="logLatestText"]')).toContainText(
      'Burn set',
    );

    await page.click('[data-testid="confirmBtn"]');

    await expect
      .poll(async () => page.locator('[data-testid="phaseInfo"]').textContent())
      .toContain("OPPONENT'S TURN");
    await expect(page.locator('[data-testid="fuelGauge"]')).toContainText(
      '19/20',
    );
  });

  test('renders the touch-oriented HUD and help overlay in a mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await launchSinglePlayerScenario(page, 'biplanetary');

    await waitForDisplay(page, '[data-testid="logLatestBar"]', 'block');
    await expect(page.locator('[data-testid="chatInputRow"]')).toBeHidden();

    await openHelpOverlay(page);
    await expect(page.locator('[data-testid="helpOverlay"]')).toContainText(
      'Tap ship',
    );
    await expect(page.locator('[data-testid="helpOverlay"]')).toContainText(
      'Tap arrow',
    );
  });

  test('keeps the guided mission picker inside a narrow phone viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openHomePage(page, { tutorialDone: true });
    await page.click('[data-testid="singlePlayerBtn"]');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');

    const layout = await page.evaluate(() => {
      const list = document.getElementById('scenarioList');
      const training = document.querySelector('[data-training-flight="true"]');
      if (
        !(list instanceof HTMLElement) ||
        !(training instanceof HTMLElement)
      ) {
        return null;
      }
      const card = training.getBoundingClientRect();
      return {
        listFits: list.scrollWidth <= list.clientWidth,
        cardLeft: card.left,
        cardRight: card.right,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout?.listFits).toBe(true);
    expect(layout?.cardLeft ?? -1).toBeGreaterThanOrEqual(0);
    expect(layout?.cardRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      layout?.viewportWidth ?? 0,
    );
  });

  test('keeps a plotted course summary readable on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await launchSinglePlayerScenario(page, 'biplanetary', {
      tutorialDone: true,
    });

    await page.keyboard.press('1');
    const gauge = page.locator('[data-testid="fuelGauge"]');
    await expect(gauge).toContainText('Burn · −1 fuel · next speed 1');

    const bounds = await gauge.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(375);
  });

  test('fleet building can return to the menu before launch', async ({
    page,
  }) => {
    await openHomePage(page, { tutorialDone: true });
    await page.click('[data-testid="singlePlayerBtn"]');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
    await page.click('[data-scenario="fleetAction"]');
    await waitForDisplay(page, '[data-testid="fleetBuilding"]', 'flex');

    await expect(page.locator('[data-testid="fleetExitBtn"]')).toBeVisible();
    await page.click('[data-testid="fleetExitBtn"]');
    await waitForDisplay(page, '[data-testid="menu"]', 'flex');

    await page.click('[data-testid="singlePlayerBtn"]');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
    await page.click('[data-scenario="interplanetaryWar"]');
    await waitForDisplay(page, '[data-testid="fleetBuilding"]', 'flex');

    await page.keyboard.press('Escape');
    await waitForDisplay(page, '[data-testid="menu"]', 'flex');
  });

  test('keeps the phone phase banner clear of ship cards', async ({
    browser,
  }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 360, height: 640 },
      { width: 375, height: 812 },
    ]) {
      const page = await browser.newPage({ viewport });

      try {
        await launchSinglePlayerScenario(page, 'biplanetary', {
          tutorialDone: true,
        });

        await expect
          .poll(async () =>
            page
              .locator('#phaseAlert')
              .evaluate((element) => element.classList.contains('active')),
          )
          .toBe(true);

        const measurement = await page.evaluate(() => {
          const alert = document.querySelector('#phaseAlert');
          const ship = document.querySelector('[data-testid="ship-entry"]');

          if (
            !(alert instanceof HTMLElement) ||
            !(ship instanceof HTMLElement)
          ) {
            throw new Error(
              'Expected phase alert and ship entry to be present',
            );
          }

          const alertBox = alert.getBoundingClientRect();
          const shipBox = ship.getBoundingClientRect();
          const overlapWidth = Math.max(
            0,
            Math.min(alertBox.right, shipBox.right) -
              Math.max(alertBox.left, shipBox.left),
          );
          const overlapHeight = Math.max(
            0,
            Math.min(alertBox.bottom, shipBox.bottom) -
              Math.max(alertBox.top, shipBox.top),
          );

          return {
            overlapArea: overlapWidth * overlapHeight,
            alertBox: {
              top: alertBox.top,
              right: alertBox.right,
              bottom: alertBox.bottom,
              left: alertBox.left,
            },
            shipBox: {
              top: shipBox.top,
              right: shipBox.right,
              bottom: shipBox.bottom,
              left: shipBox.left,
            },
          };
        });

        expect(
          measurement.overlapArea,
          `${viewport.width}x${viewport.height}: ${JSON.stringify(measurement)}`,
        ).toBe(0);
      } finally {
        await page.close();
      }
    }
  });
});
