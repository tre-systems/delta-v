import { expect, test } from '@playwright/test';
import {
  closePages,
  createMultiplayerSession,
  expandDesktopLog,
  openHomePage,
  submitRoomJoin,
} from './support/app';
import { waitForDisplay } from './support/ui';

test.describe('multiplayer smoke tests', () => {
  test('creates and joins a multiplayer room in two browser pages', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      await expect(
        session.host.locator('[data-testid="objective"]'),
      ).toContainText('Land on');
      await expect(
        session.guest.locator('[data-testid="objective"]'),
      ).toContainText('Land on');
    } finally {
      await session.close();
    }
  });

  test('delivers chat messages between multiplayer players', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      await expandDesktopLog(session.host);
      await expandDesktopLog(session.guest);

      await session.host
        .locator('[data-testid="chatInput"]')
        .fill('hello from host');
      await session.host.locator('[data-testid="chatInput"]').press('Enter');

      await expect(
        session.guest.locator('[data-testid="logEntries"]'),
      ).toContainText('Opponent: hello from host');
    } finally {
      await session.close();
    }
  });

  test('reconnects a joined player after a full page refresh', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      await session.guest.reload({ waitUntil: 'domcontentloaded' });
      await waitForDisplay(session.guest, '[data-testid="hud"]', 'block');
      await expect(
        session.guest.locator('[data-testid="objective"]'),
      ).toContainText('Land on');
      await expect(
        session.guest.locator('[data-testid="reconnectOverlay"]'),
      ).toBeHidden();
    } finally {
      await session.close();
    }
  });

  test('drops a third player into spectator mode on a full room', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);
    const intruder = await browser.newPage();

    try {
      await openHomePage(intruder, { tutorialDone: true });
      await submitRoomJoin(intruder, session.roomCode);
      // No "full room" toast — the client treats the 409 as an automatic
      // spectator upgrade and connects through the spectator viewer path.
      await waitForDisplay(intruder, '[data-testid="hud"]', 'block', 15_000);
      await expect(
        intruder.locator('[data-testid="toastContainer"]'),
      ).not.toContainText('That game is already full');
    } finally {
      await closePages(intruder);
      await session.close();
    }
  });

  test('quick-match pairs two players into the same room', async ({
    browser,
  }) => {
    // Smoke-tests the matchmaker's happy path end-to-end through the
    // browser: two isolated contexts each hit the quick-match button and
    // must land in the SAME room. Complements the unit-level coverage in
    // matchmaker-do.more.test.ts (which covers 409 collisions and the
    // pairing-split log line) — this one proves the full UI → HTTP →
    // MatchmakerDO → GameDO → WebSocket path works for real.
    //
    // Each player needs a distinct `delta-v:player-profile` entry or the
    // matchmaker treats them as the same enqueue. We seed each context's
    // localStorage with a unique playerKey before boot.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);

    const seedProfile = async (
      page: typeof pageA,
      playerKey: string,
    ): Promise<void> => {
      await page.addInitScript(
        ({ key, profile }) => {
          window.localStorage.setItem(
            'delta-v:player-profile',
            JSON.stringify(profile),
          );
          // Unset the test session-seeded flag used by seedLocalStorage so
          // the subsequent openHomePage doesn't wipe the profile we just
          // placed.
          window.sessionStorage.setItem('__deltav_e2e_seeded', '1');
          window.localStorage.setItem('deltav_tutorial_done', '1');
          void key;
        },
        {
          key: playerKey,
          profile: {
            playerKey,
            username: playerKey,
            updatedAt: Date.now(),
          },
        },
      );
    };

    try {
      await seedProfile(pageA, `qm-a-${uniqueSuffix}`);
      await seedProfile(pageB, `qm-b-${uniqueSuffix}`);

      await pageA.goto('/', { waitUntil: 'domcontentloaded' });
      await pageB.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForDisplay(pageA, '[data-testid="menu"]', 'flex');
      await waitForDisplay(pageB, '[data-testid="menu"]', 'flex');

      await pageA.click('[data-testid="quickMatchBtn"]');
      await pageB.click('[data-testid="quickMatchBtn"]');

      // Both players must reach the HUD (matchmaker allocated a room,
      // GameDO accepted the joins, WebSockets connected, state arrived).
      await Promise.all([
        waitForDisplay(pageA, '[data-testid="hud"]', 'block', 30_000),
        waitForDisplay(pageB, '[data-testid="hud"]', 'block', 30_000),
      ]);

      // Room codes match → they are in the same game. Split pairings
      // would land each in a different room. The quick-match flow calls
      // `history.replaceState` with `?code=<roomCode>` when a match is
      // found, so we read the code from each page's URL.
      const readRoomCode = (page: typeof pageA): string => {
        const url = new URL(page.url());
        return url.searchParams.get('code') ?? '';
      };

      const codeA = readRoomCode(pageA);
      const codeB = readRoomCode(pageB);
      expect(codeA).toMatch(/^[A-Z0-9]{5}$/);
      expect(codeA).toBe(codeB);
    } finally {
      await closePages(pageA, pageB);
      await contextA.close();
      await contextB.close();
    }
  });
});
