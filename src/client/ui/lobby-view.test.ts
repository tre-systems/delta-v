// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOAST, toastJoinInvalidCode } from '../messages/toasts';
import { createLobbyView } from './lobby-view';

const installFixture = () => {
  document.body.innerHTML = `
    <button id="quickMatchBtn">Quick Match</button>
    <button id="createBtn">Create Game</button>
    <button id="singlePlayerBtn">Single Player</button>
    <input id="playerNameInput" />
    <button id="backBtn">Back</button>
    <div id="scenarioList"></div>
    <button class="btn-difficulty" data-difficulty="easy">Easy</button>
    <button class="btn-difficulty active" data-difficulty="normal">Normal</button>
    <button class="btn-difficulty" data-difficulty="hard">Hard</button>
    <button id="joinBtn">Join</button>
    <input id="codeInput" />
    <button id="copyBtn">Copy Link</button>
    <button id="copySpectateBtn">Copy Spectate Link</button>
    <button id="cancelWaitingBtn">Cancel search</button>
    <div id="waitingTitle"></div>
    <div id="gameCode"></div>
    <p id="waitingScenario" hidden></p>
    <div id="waitingStatus"></div>
    <button id="menuHowToPlayBtn">How to Play</button>
    <div id="helpOverlay"></div>
    <button id="helpCloseBtn">Close</button>
    <div id="callsignStatus"></div>
  `;
};

describe('LobbyView', () => {
  beforeEach(() => {
    installFixture();
    (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: unknown;
      }
    ).__DELTA_V_FEATURE_FLAGS = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: unknown;
      }
    ).__DELTA_V_FEATURE_FLAGS = undefined;
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
          getPlayerName: () => 'Pilot 1',
          setPlayerName: (name) => name,
          getPlayerKey: () => 'humankey12345678',
          postClaimName: async () => ({
            ok: true,
            player: {
              username: 'Pilot 1',
              isAgent: false,
              rating: 1500,
              rd: 350,
              gamesPlayed: 0,
            },
            renamed: false,
          }),
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
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name,
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1500,
          rd: 350,
          gamesPlayed: 0,
        },
        renamed: false,
      }),
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
    const playerToken = 'A2345678901234567890123456789012';
    const emit = vi.fn();
    const showMenu = vi.fn();
    createLobbyView({
      emit,
      showMenu,
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name,
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1500,
          rd: 350,
          gamesPlayed: 0,
        },
        renamed: false,
      }),
    });

    const input = document.getElementById('codeInput') as HTMLInputElement;
    input.value = `https://example.test/?code=abcde&playerToken=${playerToken}`;
    input.dispatchEvent(new Event('input'));
    document.getElementById('joinBtn')?.click();

    expect(emit).toHaveBeenCalledWith({
      type: 'join',
      code: 'ABCDE',
      playerToken,
    });

    document.getElementById('backBtn')?.click();
    expect(emit).toHaveBeenCalledWith({ type: 'backToMenu' });
    expect(showMenu).toHaveBeenCalledTimes(1);
  });

  it('updates waiting copy, menu loading, and copy-link feedback', async () => {
    vi.useFakeTimers();
    const copyText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    const view = createLobbyView({
      emit: vi.fn(),
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name,
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1500,
          rd: 350,
          gamesPlayed: 0,
        },
        renamed: false,
      }),
      copyText,
    });

    view.setMenuLoading(true, 'create');
    expect(
      (document.getElementById('createBtn') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.getElementById('createBtn')?.textContent).toBe(
      'CREATING...',
    );

    view.setWaitingState({
      kind: 'private',
      code: 'ABCDE',
      connecting: false,
    });
    expect(document.getElementById('waitingTitle')?.textContent).toBe(
      'Game Created',
    );
    expect(document.getElementById('gameCode')?.textContent).toBe('ABCDE');
    expect(document.getElementById('gameCode')?.dataset.variant).toBe(
      'roomCode',
    );
    expect(document.getElementById('waitingStatus')?.textContent).toBe(
      'Waiting for opponent...',
    );

    view.setWaitingState({
      kind: 'quickMatch',
      statusText: 'Searching for an opponent...',
    });
    expect(document.getElementById('waitingTitle')?.textContent).toBe(
      'Quick Match',
    );
    expect(document.getElementById('gameCode')?.textContent).toBe('SEARCHING');
    expect(document.getElementById('gameCode')?.dataset.variant).toBe(
      'statusWord',
    );
    expect(document.getElementById('waitingStatus')?.textContent).toBe(
      'Searching for an opponent...',
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
    vi.useRealTimers();
  });

  it('shows spectator link controls when feature is enabled and a private room is waiting', () => {
    const view = createLobbyView({
      emit: vi.fn(),
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name,
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1500,
          rd: 350,
          gamesPlayed: 0,
        },
        renamed: false,
      }),
    });

    // Activate the private-room waiting state so copy actions render;
    // initial boot starts with a blank waiting card so pregame copy
    // never leaks into the accessibility tree on menu load.
    view.setWaitingState({ kind: 'private', code: 'ABCDE', connecting: false });

    // spectatorMode defaults to true — the copy-spectate button is now visible.
    expect(
      (document.getElementById('copySpectateBtn') as HTMLElement).hasAttribute(
        'hidden',
      ),
    ).toBe(false);
  });

  it('disables join button when input is empty or invalid and shows toast on submit', () => {
    const showToast = vi.fn();
    createLobbyView({
      emit: vi.fn(),
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast,
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name,
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1500,
          rd: 350,
          gamesPlayed: 0,
        },
        renamed: false,
      }),
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
    expect(showToast).toHaveBeenCalledWith(TOAST.lobby.joinNeedCode, 'error');

    // Shows toast for invalid code via Enter key
    input.value = 'AB';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(showToast).toHaveBeenCalledWith(toastJoinInvalidCode(5), 'error');
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
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name,
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1500,
          rd: 350,
          gamesPlayed: 0,
        },
        renamed: false,
      }),
    });

    view.dispose();

    document.getElementById('createBtn')?.click();
    document.getElementById('backBtn')?.click();
    document.getElementById('joinBtn')?.click();

    expect(showScenarioSelect).not.toHaveBeenCalled();
    expect(showMenu).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('claims the current callsign before quick-match emit', async () => {
    const emit = vi.fn();
    const setPlayerName = vi.fn((name: string) => name.trim());
    const postClaimName = vi.fn(async () => ({
      ok: true as const,
      player: {
        username: 'Pilot 1',
        isAgent: false,
        rating: 1500,
        rd: 350,
        gamesPlayed: 0,
      },
      renamed: false,
    }));
    createLobbyView({
      emit,
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
      getPlayerName: () => 'Pilot 1',
      setPlayerName,
      getPlayerKey: () => 'humankey12345678',
      postClaimName,
    });

    const playerNameInput = document.getElementById(
      'playerNameInput',
    ) as HTMLInputElement;
    playerNameInput.value = '  Pilot 1  ';

    document.getElementById('quickMatchBtn')?.click();

    await expect.poll(() => emit.mock.calls.length).toBeGreaterThan(0);

    expect(setPlayerName).toHaveBeenCalledWith('  Pilot 1  ');
    expect(postClaimName).toHaveBeenCalledWith({
      playerKey: 'humankey12345678',
      username: 'Pilot 1',
    });
    expect(emit).toHaveBeenCalledWith({ type: 'quickMatch' });
  });

  it('does not queue quick match when callsign is taken', async () => {
    const emit = vi.fn();
    createLobbyView({
      emit,
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast: vi.fn(),
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name.trim(),
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({ ok: false as const, error: 'name_taken' }),
    });

    document.getElementById('quickMatchBtn')?.click();
    await expect
      .poll(
        () => document.querySelector('.menu-profile-status')?.textContent ?? '',
      )
      .toContain('taken');
    expect(emit).not.toHaveBeenCalled();
  });

  it('shows an info toast when claim fails online but still queues quick match', async () => {
    const emit = vi.fn();
    const showToast = vi.fn();
    createLobbyView({
      emit,
      showMenu: vi.fn(),
      showScenarioSelect: vi.fn(),
      showToast,
      getPlayerName: () => 'Pilot 1',
      setPlayerName: (name) => name.trim(),
      getPlayerKey: () => 'humankey12345678',
      postClaimName: async () => ({ ok: false as const, error: 'network' }),
    });

    document.getElementById('quickMatchBtn')?.click();

    await expect.poll(() => emit.mock.calls.length).toBeGreaterThan(0);
    expect(showToast).toHaveBeenCalledWith(
      TOAST.lobby.claimCouldNotSaveOnline,
      'info',
    );
    expect(emit).toHaveBeenCalledWith({ type: 'quickMatch' });
  });
});
