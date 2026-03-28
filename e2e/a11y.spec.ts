import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const waitForDisplay = async (
  page: Page,
  selector: string,
  expectedDisplay: string,
): Promise<void> => {
  await expect
    .poll(async () => {
      return page.locator(selector).evaluate((element) => {
        return window.getComputedStyle(element).display;
      });
    })
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

const runA11yCheck = async (
  page: Page,
  includeSelectors: string[],
): Promise<void> => {
  let builder = new AxeBuilder({ page })
    .exclude('canvas')
    // Contrast is manually audited because this game uses dynamic translucent overlays.
    .disableRules(['color-contrast'])
    .withTags(['wcag2a', 'wcag2aa'])
    .options({
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa'],
      },
    });

  for (const selector of includeSelectors) {
    builder = builder.include(selector);
  }

  const results = await builder.analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === 'critical' || violation.impact === 'serious';
  });

  expect(
    blockingViolations,
    blockingViolations
      .map((violation) => {
        return [
          `${violation.id} (${violation.impact ?? 'unknown'})`,
          `help: ${violation.help}`,
          `nodes:`,
          ...violation.nodes.map((node) => `  - ${node.target.join(', ')}`),
        ].join('\n');
      })
      .join('\n\n'),
  ).toEqual([]);
};

const activeElementId = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    return (document.activeElement as HTMLElement | null)?.id ?? '';
  });
};

test.describe('accessibility smoke checks', () => {
  test('menu view has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForDisplay(page, '#menu', 'flex');
    await runA11yCheck(page, ['#menu']);
  });

  test('waiting lobby has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.click('#createBtn');
    await page.click('[data-scenario="biplanetary"]');
    await waitForDisplay(page, '#waiting', 'flex');
    await runA11yCheck(page, ['#waiting']);
  });

  test('in-game HUD and help overlay have no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await launchSinglePlayer(page);
    await page.click('#helpBtn');
    await waitForDisplay(page, '#helpOverlay', 'flex');
    await runA11yCheck(page, ['#hud', '#helpOverlay']);
  });

  test('menu buttons are keyboard-focusable and Enter activates primary navigation', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForDisplay(page, '#menu', 'flex');

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
    await launchSinglePlayer(page);
    await page.click('#helpBtn');

    await waitForDisplay(page, '#helpOverlay', 'flex');
    await expect.poll(async () => activeElementId(page)).toBe('helpCloseBtn');

    await page.click('#helpCloseBtn');
    await waitForDisplay(page, '#helpOverlay', 'none');
    await expect.poll(async () => activeElementId(page)).toBe('helpBtn');
  });
});
