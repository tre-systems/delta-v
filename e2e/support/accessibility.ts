import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const runA11yCheck = async (
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
