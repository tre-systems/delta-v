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
      await expect(page.locator('[data-testid="objective"]')).toContainText(
        'Tour:',
      );
      await expect(page.locator('[data-testid="objective"]')).toContainText(
        '/9',
      );
    },
  },
  {
    name: 'Duel vs AI boots with combat objective',
    scenario: 'duel',
    assertLoaded: async (page) => {
      await expect(page.locator('[data-testid="phaseInfo"]')).toContainText(
        'ASTROGATION',
      );
    },
  },
  {
    name: 'Convoy vs AI boots into astrogation',
    scenario: 'convoy',
    assertLoaded: async (page) => {
      await expect(page.locator('[data-testid="phaseInfo"]')).toContainText(
        'ASTROGATION',
      );
      await expect(page.locator('[data-testid="ship-entry"]')).toHaveCount(3);
    },
  },
  {
    name: 'Escape vs AI boots with multiple pilgrim ships',
    scenario: 'escape',
    assertLoaded: async (page) => {
      await expect(page.locator('[data-testid="ship-entry"]')).toHaveCount(3);
    },
  },
  {
    name: 'Blockade Runner vs AI boots with the runner packet',
    scenario: 'blockade',
    assertLoaded: async (page) => {
      await expect(page.locator('[data-testid="ship-entry"]')).toHaveCount(1);
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

    await expect(page.locator('[data-testid="menu"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(
      page.locator('[data-testid="scenarioSelect"]'),
    ).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('[data-testid="waiting"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.locator('[data-testid="fleetBuilding"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.locator('[data-testid="helpOverlay"]')).toHaveAttribute(
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

      await expect(page.locator('[data-testid="objective"]')).toBeVisible();
      await scenarioCase.assertLoaded(page);
    });
  }

  test('Fleet Action vs AI completes fleet pick and reaches HUD', async ({
    page,
  }) => {
    await launchFleetActionScenario(page);

    await expect(page.locator('[data-testid="phaseInfo"]')).toContainText(
      'ASTROGATION',
    );
    await expect(
      page.locator('[data-testid="ship-entry"]').first(),
    ).toBeVisible();
  });

  test('help overlay can be opened and closed', async ({ page }) => {
    await launchSinglePlayerScenario(page, 'biplanetary', {
      tutorialDone: true,
      skipTutorial: true,
    });

    await openHelpOverlay(page);
    await expect(
      page.locator('[data-testid="helpOverlay"]'),
    ).not.toHaveAttribute('aria-hidden', 'true');

    await page.click('[data-testid="helpCloseBtn"]');
    await waitForDisplay(page, '[data-testid="helpOverlay"]', 'none');
    await expect(page.locator('[data-testid="helpOverlay"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

test.describe('Join as an Agent onboarding', () => {
  test('leads with supported clients and a complete first-match path', async ({
    page,
  }) => {
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Join Delta-V as an Agent',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('support-matrix')).toContainText(
      'Codex CLI and IDE',
    );
    await expect(page.getByTestId('support-matrix')).toContainText(
      'ChatGPT desktop',
    );
    await expect(page.getByTestId('support-matrix')).toContainText(
      'Claude Code',
    );
    await expect(page.getByTestId('support-matrix')).toContainText(
      'ChatGPT on the web',
    );

    const body = page.locator('body');
    await expect(body).toContainText('Authenticate your AI');
    await expect(body).toContainText('Save the renewal secret now');
    await expect(body).toContainText('DELTA_V_AGENT_SECRET');
    await expect(body).toContainText('codex mcp add delta-v');
    await expect(body).toContainText('claude mcp add --transport http');
    await expect(body).toContainText('Authorization: Bearer');
    await expect(body).toContainText('Settings → Security and login');
    await expect(body).toContainText(
      'ChatGPT should discover the Delta-V tools',
    );
    await expect(body).toContainText('Authorize bot');
    await expect(body).toContainText('ChatGPT refreshes access automatically');
    await expect(body).toContainText('Public rated match');
    await expect(body).toContainText('Private two-agent test');
    await expect(body).toContainText('two separate MCP client instances');
    await expect(body).toContainText('delta_v_pair_quick_match_tickets');
    await expect(body).toContainText('Wait for turn');
    await expect(body).toContainText('Close session');

    const singleHostPairingNote = page.getByTestId('single-host-pairing-note');
    await expect(singleHostPairingNote).toContainText('waitForOpponent: false');
    await expect(singleHostPairingNote.getByRole('link')).toHaveAttribute(
      'href',
      'https://github.com/tre-systems/delta-v/blob/main/docs/DELTA_V_MCP.md#stdio-quick-match-operational-notes',
    );

    const structuralChecks = await page.evaluate(() => {
      const connect = document.querySelector('#connect');
      const developerReference = document.querySelector('#developers');
      const brokenAnchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
      )
        .map((link) => link.getAttribute('href'))
        .filter(
          (href): href is string =>
            href !== null &&
            href !== '' &&
            document.querySelector(href) === null,
        );
      return {
        setupBeforeReference: Boolean(
          connect &&
            developerReference &&
            connect.compareDocumentPosition(developerReference) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        brokenAnchors,
      };
    });

    expect(structuralChecks.setupBeforeReference).toBe(true);
    expect(structuralChecks.brokenAnchors).toEqual([]);
  });

  test('presents a readable ChatGPT OAuth consent screen', async ({ page }) => {
    const clientResponse = await page.request.get('/oauth/test-client.json');
    expect(clientResponse.ok()).toBe(true);
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
      state: 'playwright-consent',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });

    await page.goto(`/oauth/authorize?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Authorize a bot' }),
    ).toBeVisible();
    await expect(page.getByText('Permission:', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Bot callsign')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Authorize bot' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.locator('main')).toContainText(
      'The app cannot access unrelated account or device data.',
    );
  });

  test('keeps the page inside a narrow mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      codeBlocks: Array.from(document.querySelectorAll('pre')).map((pre) => {
        const rect = pre.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          overflowX: getComputedStyle(pre).overflowX,
        };
      }),
    }));

    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.codeBlocks.length).toBeGreaterThan(0);
    for (const block of layout.codeBlocks) {
      expect(block.left).toBeGreaterThanOrEqual(0);
      expect(block.right).toBeLessThanOrEqual(layout.viewportWidth);
      expect(['auto', 'scroll']).toContain(block.overflowX);
    }
  });
});
