import { expect, test } from '@playwright/test';
import { runA11yCheck } from './support/accessibility';
import {
  createRoom,
  expandDesktopLog,
  launchFleetActionScenario,
  launchSinglePlayerScenario,
  openHelpOverlay,
  openHomePage,
} from './support/app';
import { activeElementId, waitForDisplay } from './support/ui';

test.describe('accessibility smoke checks', () => {
  test('menu view has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForDisplay(page, '#menu', 'flex');
    await runA11yCheck(page, ['#menu']);
  });

  test('waiting lobby has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await createRoom(page);
    await runA11yCheck(page, ['#waiting']);
  });

  test('in-game HUD and help overlay have no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');
    await openHelpOverlay(page);
    await runA11yCheck(page, ['#hud', '#helpOverlay']);
  });

  test('menu controls are keyboard-focusable and Enter activates primary navigation', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForDisplay(page, '#menu', 'flex');

    await page.keyboard.press('Tab');
    await expect
      .poll(async () => activeElementId(page))
      .toBe('playerNameInput');

    await page.keyboard.press('Tab');
    await expect.poll(async () => activeElementId(page)).toBe('quickMatchBtn');

    await page.keyboard.press('Tab');
    await expect.poll(async () => activeElementId(page)).toBe('createBtn');

    await page.keyboard.press('Tab');
    await expect
      .poll(async () => activeElementId(page))
      .toBe('singlePlayerBtn');

    await page.keyboard.press('Enter');
    await waitForDisplay(page, '#scenarioSelect', 'flex');
  });

  test('help overlay moves focus to close and restores focus on close', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');
    await openHelpOverlay(page);
    await expect.poll(async () => activeElementId(page)).toBe('helpCloseBtn');

    await page.click('#helpCloseBtn');
    await waitForDisplay(page, '#helpOverlay', 'none');
    await expect.poll(async () => activeElementId(page)).toBe('helpBtn');
  });

  test('fleet-building screen has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    // Fleet Action is the only stock scenario that goes through a
    // fleet-building phase; axe-check that the shop + cart shell renders
    // clean before we commit to a fleet and enter the HUD. This extends
    // a11y coverage beyond the main HUD surface that prior tests covered.
    await launchFleetActionScenario(page);
    // launchFleetActionScenario lands on the HUD after picking a ship;
    // reset back to fleet-building by re-launching for the axe check.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForDisplay(page, '#menu', 'flex');
    await page.click('#singlePlayerBtn');
    await waitForDisplay(page, '#scenarioSelect', 'flex');
    await page.click('[data-scenario="fleetAction"]');
    await waitForDisplay(page, '#fleetBuilding', 'flex');
    await runA11yCheck(page, ['#fleetBuilding']);
  });

  test('desktop log panel has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    // Extends a11y coverage to the expanded game-log panel, which hosts
    // chat input + log entries and is only reachable after a scenario is
    // running. Skipped axe previously because the log starts collapsed.
    await launchSinglePlayerScenario(page, 'biplanetary', {
      tutorialDone: true,
      skipTutorial: true,
    });
    await expandDesktopLog(page);
    await runA11yCheck(page, ['#gameLog']);
  });
});
