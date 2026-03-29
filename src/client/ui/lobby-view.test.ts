// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLobbyView } from './lobby-view';

const installFixture = () => {
  document.body.innerHTML = `
    <button id="createBtn">Create Game</button>
    <button id="singlePlayerBtn">Single Player</button>
    <button id="backBtn">Back</button>
    <div id="scenarioList"></div>
    <button class="btn-difficulty" data-difficulty="easy">Easy</button>
    <button class="btn-difficulty active" data-difficulty="normal">Normal</button>
    <button class="btn-difficulty" data-difficulty="hard">Hard</button>
    <button id="joinBtn">Join</button>
    <input id="codeInput" />
    <button id="copyBtn">Copy Link</button>
    <div id="gameCode"></div>
    <div id="waitingStatus"></div>
  `;
};

describe('LobbyView', () => {
  beforeEach(() => {
    installFixture();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not throw when global localStorage lacks Storage methods (uses window)', () => {
    vi.stubGlobal('localStorage', {} as Storage);
    try {
      expect(() =>
        createLobbyView({
          emit: vi.fn(),
          showMenu: vi.fn(),
          showScenarioSelect: vi.fn(),
          showToast: vi.fn(),
        }),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('emits multiplayer and single-player scenario events', () => {
    const emit = vi.fn();
    const showMenu = vi.fn();
    const showScenarioSelect = vi.fn();
    createLobbyView({
      emit,
      showMenu,
      showScenarioSelect,
      showToast: vi.fn(),
    });

    document.getElementById('createBtn')?.click();
    expect(showScenarioSelect).toHaveBeenCalledTimes(1);

    const scenarioButtons = Array.from(
      document.querySelectorAll<HTMLElement>('#scenarioList .btn-scenario'),
    );
    scenarioButtons[0]?.click();
    expect(emit).toHaveBeenCalledWith({
      type: 'selectScenario',
      scenario: scenarioButtons[0]?.dataset.scenario,
    });

    document.getElementById('singlePlayerBtn')?.click();
    (
      document.querySelector('[data-difficulty="hard"]') as HTMLElement
    )?.click();
    scenarioButtons[1]?.click();
    expect(emit).toHaveBeenCalledWith({
      type: 'startSinglePlayer',
      scenario: scenarioButtons[1]?.dataset.scenario,
      difficulty: 'hard',
    });
  });

  it('parses join input and back navigation', () => {
    const emit = vi.fn();
    const showMenu = vi.fn();
    createLobbyView({
      emit,
      showMenu,
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
    });

    const input = document.getElementById('codeInput') as HTMLInputElement;
    input.value = 'https://example.test/?code=abcde&playerToken=tok';
    input.dispatchEvent(new Event('input'));
    document.getElementById('joinBtn')?.click();

    expect(emit).toHaveBeenCalledWith({
      type: 'join',
      code: 'ABCDE',
      playerToken: 'tok',
    });

    document.getElementById('backBtn')?.click();
    expect(emit).toHaveBeenCalledWith({ type: 'backToMenu' });
    expect(showMenu).toHaveBeenCalledTimes(1);
  });

  it('updates waiting copy, menu loading, and copy-link feedback', async () => {
    const copyText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    const view = createLobbyView({
      emit: vi.fn(),
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
      copyText,
    });

    view.setMenuLoading(true);
    expect(
      (document.getElementById('createBtn') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.getElementById('createBtn')?.textContent).toBe(
      'CREATING...',
    );

    view.showWaiting('ABCDE');
    expect(document.getElementById('gameCode')?.textContent).toBe('ABCDE');
    expect(document.getElementById('waitingStatus')?.textContent).toBe(
      'Waiting for opponent...',
    );

    view.showConnecting();
    expect(document.getElementById('gameCode')?.textContent).toBe('...');
    expect(document.getElementById('waitingStatus')?.textContent).toBe(
      'Connecting...',
    );

    const gameCode = document.getElementById('gameCode');
    expect(gameCode).not.toBeNull();
    if (!gameCode) {
      throw new Error('Expected #gameCode');
    }
    gameCode.textContent = 'ABCDE';
    document.getElementById('copyBtn')?.click();
    await Promise.resolve();

    expect(copyText).toHaveBeenCalledWith('http://localhost:3000/?code=ABCDE');
    expect(document.getElementById('copyBtn')?.textContent).toBe('Copied!');

    vi.advanceTimersByTime(2000);
    expect(document.getElementById('copyBtn')?.textContent).toBe('Copy Link');
  });

  it('disables join button when input is empty or invalid and shows toast on submit', () => {
    const showToast = vi.fn();
    createLobbyView({
      emit: vi.fn(),
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast,
    });

    const input = document.getElementById('codeInput') as HTMLInputElement;
    const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement;

    // Initially disabled (empty input)
    expect(joinBtn.disabled).toBe(true);

    // Still disabled with too-short code
    input.value = 'AB';
    input.dispatchEvent(new Event('input'));
    expect(joinBtn.disabled).toBe(true);

    // Enabled with valid 5-char code
    input.value = 'ABCDE';
    input.dispatchEvent(new Event('input'));
    expect(joinBtn.disabled).toBe(false);

    // Shows toast for empty submit via Enter key
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(showToast).toHaveBeenCalledWith(
      'Enter a game code to join',
      'error',
    );

    // Shows toast for invalid code via Enter key
    input.value = 'AB';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(showToast).toHaveBeenCalledWith(
      'Invalid code \u2014 must be 5 characters',
      'error',
    );
  });

  it('removes button listeners on dispose', () => {
    const emit = vi.fn();
    const showMenu = vi.fn();
    const showScenarioSelect = vi.fn();
    const view = createLobbyView({
      emit,
      showMenu,
      showScenarioSelect,
      showToast: vi.fn(),
    });

    view.dispose();

    document.getElementById('createBtn')?.click();
    document.getElementById('backBtn')?.click();
    document.getElementById('joinBtn')?.click();

    expect(showScenarioSelect).not.toHaveBeenCalled();
    expect(showMenu).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
