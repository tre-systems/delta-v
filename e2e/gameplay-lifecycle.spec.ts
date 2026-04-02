import { expect, test } from '@playwright/test';
import { createMultiplayerSession } from './support/app';
import { waitForDisplay } from './support/ui';

test.describe('gameplay lifecycle', () => {
  test('strictly adheres to interaction states during phase transitions', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      // 1. Astrogation Phase
      await waitForDisplay(session.host, '#hud', 'block');
      await expect(session.host.locator('#objective')).toContainText('Land on');

      // In a single-ship scenario, confirm is immediately available
      // (no multi-ship skip workflow required)
      await expect(session.host.locator('#confirmBtn')).toBeVisible();
      await expect(session.host.locator('#fireBtn')).toBeHidden();

      // Both players confirm their astrogation turn (no burns = drift)
      await session.host.locator('#confirmBtn').click();
      await expect(session.host.locator('#confirmBtn')).toBeHidden();

      await session.guest.locator('#confirmBtn').click();
      await expect(session.guest.locator('#confirmBtn')).toBeHidden();

      // 2. Movement Animation
      // Once both players confirm, the game goes into animation mode.
      // We verify that no interaction buttons are visible during this time.
      await expect(session.host.locator('#confirmBtn')).toBeHidden();
      await expect(session.host.locator('#skipCombatBtn')).toBeHidden();
      await expect(session.host.locator('#attackBtn')).toBeHidden();
      await expect(session.host.locator('#fireBtn')).toBeHidden();

      // 3. After movement, the engine evaluates post-movement phases.
      // In biplanetary (corvettes far apart), no combat targets exist
      // and no ordnance is eligible, so the engine advances the turn
      // directly to the next player's astrogation phase.
      // Verify the HUD remains visible and we're back in a playable state.
      await waitForDisplay(session.host, '#hud', 'block', 15000);
      await expect(session.host.locator('#objective')).toContainText('Land on');
    } finally {
      await session.close();
    }
  });
});
