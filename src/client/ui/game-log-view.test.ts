// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameLogView } from './game-log-view';

const installFixture = () => {
  document.body.innerHTML = `
    <div id="gameLog" style="display:none"></div>
    <div id="logEntries"></div>
    <div id="chatInputRow" style="display:none"></div>
    <input id="chatInput" />
    <div id="logLatestBar" style="display:none">
      <span id="logLatestText"></span>
    </div>
  `;
};

describe('GameLogView', () => {
  beforeEach(() => {
    installFixture();
  });

  it('emits trimmed chat messages and clears the input', () => {
    const onChat = vi.fn<(text: string) => void>();
    const view = createGameLogView({ onChat });
    const input = document.getElementById('chatInput') as HTMLInputElement;

    view.setChatEnabled(true);
    input.value = '  hello there  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(onChat).toHaveBeenCalledWith('hello there');
    expect(input.value).toBe('');
    expect(
      (document.getElementById('chatInputRow') as HTMLElement).style.display,
    ).toBe('');
  });

  it('collapses to latest bar and expands on toggle', () => {
    const view = createGameLogView({ onChat: vi.fn() });
    const gameLog = document.getElementById('gameLog') as HTMLElement;
    const latestBar = document.getElementById('logLatestBar') as HTMLElement;

    view.showHUD();
    expect(gameLog.style.display).toBe('none');
    expect(latestBar.style.display).toBe('block');

    view.toggle();
    expect(gameLog.style.display).toBe('flex');
    expect(latestBar.style.display).toBe('none');

    view.toggle();
    expect(gameLog.style.display).toBe('none');
    expect(latestBar.style.display).toBe('block');
  });

  it('shows log entries and updates latest bar', () => {
    const view = createGameLogView({ onChat: vi.fn() });
    const latestText = document.getElementById('logLatestText') as HTMLElement;

    view.showHUD();

    view.logTurn(1, 'You');
    view.logTurn(2, 'Opponent');
    view.logText('Shot fired', 'log-combat');

    const entries = Array.from(
      document.querySelectorAll('#logEntries .log-entry'),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.textContent).toBe('\u2014 Turn 2: Opponent \u2014');
    expect(entries[1]?.textContent).toBe('Shot fired');
    expect(latestText.textContent).toBe('Shot fired');
    expect(latestText.className).toContain('log-combat');
  });

  it('shows status text in latest bar, overriding log text', () => {
    const view = createGameLogView({ onChat: vi.fn() });
    const latestText = document.getElementById('logLatestText') as HTMLElement;

    view.showHUD();
    view.logText('Ship moved', 'log-env');
    expect(latestText.textContent).toBe('Ship moved');

    view.setStatusText('Click to set burn direction');
    expect(latestText.textContent).toBe('Click to set burn direction');
    expect(latestText.className).toContain('log-status');

    view.setStatusText(null);
    expect(latestText.textContent).toBe('Ship moved');
    expect(latestText.className).toContain('log-env');
  });

  it('closes expanded log when clicking on it', () => {
    const view = createGameLogView({ onChat: vi.fn() });
    const gameLog = document.getElementById('gameLog') as HTMLElement;
    const latestBar = document.getElementById('logLatestBar') as HTMLElement;

    view.showHUD();
    view.toggle();
    expect(gameLog.style.display).toBe('flex');

    gameLog.click();
    expect(gameLog.style.display).toBe('none');
    expect(latestBar.style.display).toBe('block');
  });

  it('disposes chat and toggle listeners cleanly', () => {
    const onChat = vi.fn<(text: string) => void>();
    const view = createGameLogView({ onChat });
    const input = document.getElementById('chatInput') as HTMLInputElement;
    const latestBar = document.getElementById('logLatestBar') as HTMLElement;

    view.setChatEnabled(true);
    view.showHUD();
    view.dispose();

    input.value = 'hello there';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    latestBar.click();

    expect(onChat).not.toHaveBeenCalled();
    expect(
      (document.getElementById('gameLog') as HTMLElement).style.display,
    ).toBe('none');
  });
});
