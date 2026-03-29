import { expect, type Page, test } from '@playwright/test';
import {
  launchFleetActionScenario,
  launchSinglePlayerScenario,
  openHelpOverlay,
} from './support/app';
import { waitForDisplay } from './support/ui';

type ScenarioSmokeCase = {
  name: string;
  scenario: string;
  assertLoaded: (page: Page) => Promise<void>;
};

const STANDARD_SCENARIO_CASES: ScenarioSmokeCase[] = [
  {
    name: 'Grand Tour shows checkpoint race objective',
    scenario: 'grandTour',
    assertLoaded: async (page) => {
      await expect(page.locator('#objective')).toContainText('Tour:');
      await expect(page.locator('#objective')).toContainText('/8');
    },
  },
  {
    name: 'Duel vs AI boots with combat objective',
    scenario: 'duel',
    assertLoaded: async (page) => {
      await expect(page.locator('#phaseInfo')).toContainText('ASTROGATION');
    },
  },
  {
    name: 'Convoy vs AI boots into astrogation',
    scenario: 'convoy',
    assertLoaded: async (page) => {
      await expect(page.locator('#phaseInfo')).toContainText('ASTROGATION');
      await expect(page.locator('#shipList .ship-entry')).toHaveCount(3);
    },
  },
  {
    name: 'Escape vs AI boots with multiple pilgrim ships',
    scenario: 'escape',
    assertLoaded: async (page) => {
      await expect(page.locator('#shipList .ship-entry')).toHaveCount(3);
    },
  },
  {
    name: 'Blockade Runner vs AI boots with the runner packet',
    scenario: 'blockade',
    assertLoaded: async (page) => {
      await expect(page.locator('#shipList .ship-entry')).toHaveCount(1);
    },
  },
];

test.describe('scenario smoke coverage', () => {
  test('hides inactive screens from the accessibility tree while in HUD', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary', {
      tutorialDone: true,
      skipTutorial: true,
    });

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

  for (const scenarioCase of STANDARD_SCENARIO_CASES) {
    test(scenarioCase.name, async ({ page }) => {
      await launchSinglePlayerScenario(page, scenarioCase.scenario, {
        tutorialDone: true,
        skipTutorial: true,
      });

      await expect(page.locator('#objective')).toBeVisible();
      await scenarioCase.assertLoaded(page);
    });
  }

  test('Fleet Action vs AI completes fleet pick and reaches HUD', async ({
    page,
  }) => {
    await launchFleetActionScenario(page);

    await expect(page.locator('#phaseInfo')).toContainText('ASTROGATION');
    await expect(page.locator('#shipList .ship-entry').first()).toBeVisible();
  });

  test('help overlay can be opened and closed', async ({ page }) => {
    await launchSinglePlayerScenario(page, 'biplanetary', {
      tutorialDone: true,
      skipTutorial: true,
    });

    await openHelpOverlay(page);
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
