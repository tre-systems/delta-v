// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardAction } from './game/keyboard';
import {
  bindGameClientBrowserEvents,
  bindServiceWorkerControllerReload,
  type ServiceWorkerContainerLike,
} from './game-client-browser';

const createKeyboardAction = (
  overrides: Partial<KeyboardAction> = {},
): KeyboardAction =>
  ({
    kind: 'confirmOrders',
    preventDefault: true,
    ...overrides,
  }) as KeyboardAction;

describe('bindServiceWorkerControllerReload', () => {
  it('reloads only after a subsequent controllerchange event', () => {
    const serviceWorker = new EventTarget() as ServiceWorkerContainerLike & {
      register: ReturnType<typeof vi.fn>;
      controller: ServiceWorker | null;
    };
    serviceWorker.controller = null;
    serviceWorker.register = vi.fn(() => Promise.resolve(undefined));
    const location = {
      reload: vi.fn(),
    };

    const dispose = bindServiceWorkerControllerReload(serviceWorker, location);

    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(location.reload).not.toHaveBeenCalled();

    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(location.reload).toHaveBeenCalledTimes(1);

    dispose();
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('bindGameClientBrowserEvents', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <canvas id="gameCanvas"></canvas>
      <button id="helpCloseBtn"></button>
      <button id="helpBtn"></button>
      <button id="soundBtn"></button>
      <input id="textInput" />
    `;
  });

  it('routes keyboard, tooltip, help, sound, and connectivity events', () => {
    const getKeyboardAction = vi.fn(() => createKeyboardAction());
    const onKeyboardAction = vi.fn();
    const onToggleHelp = vi.fn();
    const onToggleSound = vi.fn();
    const onTooltipMove = vi.fn();
    const onTooltipLeave = vi.fn();
    const onOffline = vi.fn();
    const onOnline = vi.fn();

    bindGameClientBrowserEvents({
      canvas: document.getElementById('gameCanvas') as HTMLCanvasElement,
      helpCloseBtn: document.getElementById('helpCloseBtn') as HTMLElement,
      helpBtn: document.getElementById('helpBtn') as HTMLElement,
      soundBtn: document.getElementById('soundBtn') as HTMLElement,
      getKeyboardAction,
      onKeyboardAction,
      onToggleHelp,
      onToggleSound,
      onTooltipMove,
      onTooltipLeave,
      onOffline,
      onOnline,
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    (document.getElementById('helpCloseBtn') as HTMLButtonElement).click();
    (document.getElementById('helpBtn') as HTMLButtonElement).click();
    (document.getElementById('soundBtn') as HTMLButtonElement).click();
    (document.getElementById('gameCanvas') as HTMLCanvasElement).dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 10,
        clientY: 12,
      }),
    );
    (document.getElementById('gameCanvas') as HTMLCanvasElement).dispatchEvent(
      new MouseEvent('mouseleave', { bubbles: true }),
    );
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));

    expect(getKeyboardAction).toHaveBeenCalledTimes(1);
    expect(onKeyboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'confirmOrders' }),
    );
    expect(onToggleHelp).toHaveBeenCalledTimes(2);
    expect(onToggleSound).toHaveBeenCalledTimes(1);
    expect(onTooltipMove).toHaveBeenCalledWith(10, 12);
    expect(onTooltipLeave).toHaveBeenCalledTimes(1);
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it('blurs focused inputs on escape and removes all listeners on dispose', () => {
    const getKeyboardAction = vi.fn(() =>
      createKeyboardAction({ kind: 'none', preventDefault: false }),
    );
    const onKeyboardAction = vi.fn();
    const onTooltipMove = vi.fn();
    const onTooltipLeave = vi.fn();
    const onOffline = vi.fn();
    const onOnline = vi.fn();
    const input = document.getElementById('textInput') as HTMLInputElement;
    const blurSpy = vi.spyOn(input, 'blur');

    const dispose = bindGameClientBrowserEvents({
      canvas: document.getElementById('gameCanvas') as HTMLCanvasElement,
      helpCloseBtn: document.getElementById('helpCloseBtn') as HTMLElement,
      helpBtn: document.getElementById('helpBtn') as HTMLElement,
      soundBtn: document.getElementById('soundBtn') as HTMLElement,
      getKeyboardAction,
      onKeyboardAction,
      onToggleHelp: vi.fn(),
      onToggleSound: vi.fn(),
      onTooltipMove,
      onTooltipLeave,
      onOffline,
      onOnline,
    });

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    expect(blurSpy).toHaveBeenCalled();

    dispose();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    window.dispatchEvent(new Event('offline'));
    (document.getElementById('gameCanvas') as HTMLCanvasElement).dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 5,
        clientY: 7,
      }),
    );

    expect(getKeyboardAction).toHaveBeenCalledTimes(0);
    expect(onKeyboardAction).not.toHaveBeenCalled();
    expect(onOffline).not.toHaveBeenCalled();
    expect(onTooltipMove).not.toHaveBeenCalled();
    expect(onTooltipLeave).not.toHaveBeenCalled();
  });
});
