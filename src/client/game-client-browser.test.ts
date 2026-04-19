// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardAction } from './game/keyboard';
import {
  bindGameClientBrowserEvents,
  bindServiceWorkerControllerReload,
  type NavigatorGamepadsLike,
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

  it('routes standard gamepad buttons through the existing action path', () => {
    const onKeyboardAction = vi.fn();
    const animationFrames: FrameRequestCallback[] = [];
    let nextFrameId = 1;
    const requestAnimationFrameLike = vi.fn(
      (callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return nextFrameId++;
      },
    );
    const cancelAnimationFrameLike = vi.fn();
    const button = (pressed = false) => ({ pressed, value: pressed ? 1 : 0 });
    const buttons = Array.from({ length: 16 }, () => button(false));
    const gamepad = {
      connected: true,
      buttons,
    };
    const navigatorLike: NavigatorGamepadsLike = {
      getGamepads: () => [gamepad],
    };
    const getGamepadShortcut = vi.fn(() => ({
      directAction: createKeyboardAction(),
    }));

    const dispose = bindGameClientBrowserEvents({
      canvas: document.getElementById('gameCanvas') as HTMLCanvasElement,
      helpCloseBtn: document.getElementById('helpCloseBtn') as HTMLElement,
      helpBtn: document.getElementById('helpBtn') as HTMLElement,
      soundBtn: document.getElementById('soundBtn') as HTMLElement,
      getKeyboardAction: vi.fn(() => createKeyboardAction()),
      getGamepadShortcut,
      onKeyboardAction,
      onToggleHelp: vi.fn(),
      onToggleSound: vi.fn(),
      onTooltipMove: vi.fn(),
      onTooltipLeave: vi.fn(),
      onOffline: vi.fn(),
      onOnline: vi.fn(),
      navigatorLike,
      requestAnimationFrameLike,
      cancelAnimationFrameLike,
    });

    expect(animationFrames).toHaveLength(1);

    buttons[0] = button(true);
    buttons[4] = button(true);
    buttons[15] = button(true);
    animationFrames[0](0);

    expect(getGamepadShortcut).toHaveBeenCalledWith('confirm');
    expect(getGamepadShortcut).toHaveBeenCalledWith('previousShip');
    expect(getGamepadShortcut).toHaveBeenCalledWith('nextTarget');
    expect(onKeyboardAction).toHaveBeenCalledTimes(3);

    animationFrames[1](16);
    expect(onKeyboardAction).toHaveBeenCalledTimes(3);

    buttons[0] = button(false);
    buttons[4] = button(false);
    buttons[15] = button(false);
    animationFrames[2](32);
    buttons[1] = button(true);
    animationFrames[3](48);

    expect(getGamepadShortcut).toHaveBeenCalledWith('cancel');
    expect(onKeyboardAction).toHaveBeenCalledTimes(4);

    dispose();
    expect(cancelAnimationFrameLike).toHaveBeenCalledTimes(1);
  });
});
