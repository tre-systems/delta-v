import AxeBuilder from '@axe-core/playwright';
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
  test('Build a Bot guide passes WCAG A and AA checks', async ({ page }) => {
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(blocking).toEqual([]);
  });

  test('OAuth consent passes WCAG A and AA checks', async ({ page }) => {
    const clientResponse = await page.request.get('/oauth/test-client.json');
    const client = (await clientResponse.json()) as {
      client_id: string;
      redirect_uris: string[];
    };
    const issuer = new URL(client.client_id).origin;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0] ?? '',
      resource: `${issuer}/mcp`,
      scope: 'game:play',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
    await page.goto(`/oauth/authorize?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
    });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(blocking).toEqual([]);
  });

  test('menu view has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForDisplay(page, '[data-testid="menu"]', 'flex');
    await runA11yCheck(page, ['[data-testid="menu"]']);
  });

  test('menu surface passes WCAG2AA checks including color contrast', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForDisplay(page, '[data-testid="menu"]', 'flex');
    const results = await new AxeBuilder({ page })
      .exclude('canvas')
      .include('[data-testid="menu"]')
      .withTags(['wcag2aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking).toEqual([]);
  });

  test('waiting lobby has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await createRoom(page);
    await runA11yCheck(page, ['[data-testid="waiting"]']);
  });

  test('guided mission picker has labelled groups and no serious accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await page.click('[data-testid="singlePlayerBtn"]');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');

    await expect(page.locator('.scenario-group')).toHaveCount(4);
    await runA11yCheck(page, ['[data-testid="scenarioSelect"]']);
  });

  test('in-game HUD and help overlay have no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');
    await openHelpOverlay(page);
    await runA11yCheck(page, [
      '[data-testid="hud"]',
      '[data-testid="helpOverlay"]',
    ]);
  });

  test('menu controls are keyboard-focusable and Enter activates primary navigation', async ({
    page,
  }) => {
    // Home screen tab order (top-to-bottom DOM, confirmed against
    // static/index.html): Play vs AI → difficulty → Quick Match →
    // discover tiles → Create Private Match → join code → callsign.
    // Callsign lives with profile recovery because local AI play does
    // not need a claimed online identity.
    await openHomePage(page);
    await waitForDisplay(page, '[data-testid="menu"]', 'flex');

    await page.keyboard.press('Tab');
    await expect
      .poll(async () => activeElementId(page))
      .toBe('singlePlayerBtn');

    await page.keyboard.press('Enter');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
  });

  test('help overlay moves focus to close and restores focus on close', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');
    await openHelpOverlay(page);
    await expect.poll(async () => activeElementId(page)).toBe('helpCloseBtn');

    await page.click('[data-testid="helpCloseBtn"]');
    await waitForDisplay(page, '[data-testid="helpOverlay"]', 'none');
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
    // Clear the local-game snapshot first so resumeLocalGame() doesn't
    // restore us straight back into the in-flight game and skip the menu.
    await page.evaluate(() =>
      window.localStorage.removeItem('delta-v:local-game'),
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForDisplay(page, '[data-testid="menu"]', 'flex');
    await page.click('[data-testid="singlePlayerBtn"]');
    await waitForDisplay(page, '[data-testid="scenarioSelect"]', 'flex');
    await page.click('[data-scenario="fleetAction"]');
    await waitForDisplay(page, '[data-testid="fleetBuilding"]', 'flex');
    await runA11yCheck(page, ['[data-testid="fleetBuilding"]']);
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
    await runA11yCheck(page, ['[data-testid="gameLog"]']);
  });
});
