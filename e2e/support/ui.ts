import { expect, type Page } from '@playwright/test';

export const displayOf = async (
  page: Page,
  selector: string,
): Promise<string> => {
  return page.locator(selector).evaluate((element) => {
    return window.getComputedStyle(element).display;
  });
};

export const waitForDisplay = async (
  page: Page,
  selector: string,
  expectedDisplay: string,
  timeout?: number,
): Promise<void> => {
  if (expectedDisplay === 'none') {
    await expect
      .poll(async () => displayOf(page, selector), { timeout })
      .toBe('none');
    return;
  }

  await expect
    .poll(
      async () => {
        const display = await displayOf(page, selector);

        if (display !== 'none') {
          return true;
        }

        return page
          .locator(selector)
          .isVisible()
          .catch(() => false);
      },
      { timeout },
    )
    .toBe(true);
};

export const activeElementId = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    return (document.activeElement as HTMLElement | null)?.id ?? '';
  });
};
