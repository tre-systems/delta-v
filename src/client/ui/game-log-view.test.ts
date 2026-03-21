// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GameLogView } from './game-log-view';

const installFixture = () => {
  document.body.innerHTML = `
    <div id="gameLog" style="display:none"></div>
    <div id="logEntries"></div>
    <div id="chatInputRow" style="display:none"></div>
    <input id="chatInput" />
    <button id="logShowBtn" style="display:none"></button>
    <button id="logToggleBtn"></button>
    <div id="logLatestBar" style="display:none"></div>
    <div id="logLatestText"></div>
  `;
};

describe('GameLogView', () => {
  beforeEach(() => {
    installFixture();
  });

  it('emits trimmed chat messages and clears the input', () => {
    const onChat = vi.fn<(text: string) => void>();
    const view = new GameLogView({ onChat });
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

  it('toggles desktop log visibility between panel and show button', () => {
    const view = new GameLogView({ onChat: vi.fn() });
    const gameLog = document.getElementById('gameLog') as HTMLElement;
    const logShowBtn = document.getElementById('logShowBtn') as HTMLElement;
    const logToggleBtn = document.getElementById('logToggleBtn') as HTMLElement;

    view.setMobile(false, true);
    view.showHUD();
    expect(gameLog.style.display).toBe('flex');
    expect(logShowBtn.style.display).toBe('none');

    logToggleBtn.click();
    expect(gameLog.style.display).toBe('none');
    expect(logShowBtn.style.display).toBe('block');

    logShowBtn.click();
    expect(gameLog.style.display).toBe('flex');
    expect(logShowBtn.style.display).toBe('none');
  });

  it('uses latest-bar behavior on mobile and removes empty turn headers', () => {
    const view = new GameLogView({ onChat: vi.fn() });
    const gameLog = document.getElementById('gameLog') as HTMLElement;
    const latestBar = document.getElementById('logLatestBar') as HTMLElement;
    const latestText = document.getElementById('logLatestText') as HTMLElement;

    view.setMobile(true, false);
    view.showHUD();
    expect(gameLog.style.display).toBe('none');
    expect(latestBar.style.display).toBe('block');

    view.logTurn(1, 'You');
    view.logTurn(2, 'Opponent');
    view.logText('Shot fired', 'log-combat');

    const entries = Array.from(
      document.querySelectorAll('#logEntries .log-entry'),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]?.textContent).toBe('— Turn 2: Opponent —');
    expect(entries[1]?.textContent).toBe('Shot fired');
    expect(latestText.textContent).toBe('Shot fired');
    expect(latestText.className).toContain('log-combat');

    view.toggle();
    expect(gameLog.style.display).toBe('flex');
    expect(latestBar.style.display).toBe('none');

    view.toggle();
    expect(gameLog.style.display).toBe('none');
    expect(latestBar.style.display).toBe('block');
  });
});
