import { listen } from './dom';
import type { KeyboardAction } from './game/keyboard';
import { createDisposalScope, type Dispose, withScope } from './reactive';

export interface ServiceWorkerContainerLike extends EventTarget {
  controller: ServiceWorker | null;
  register(scriptURL: string): Promise<unknown>;
}

export interface LocationReloadLike {
  reload(): void;
}

type GamepadShortcut =
  | { key: string; shiftKey?: boolean }
  | { directAction: KeyboardAction };

type GamepadControl =
  | 'confirm'
  | 'cancel'
  | 'previousShip'
  | 'nextShip'
  | 'previousTarget'
  | 'nextTarget'
  | 'previousAttacker'
  | 'nextAttacker'
  | 'toggleLog'
  | 'focusNearestEnemy'
  | 'focusOwnFleet'
  | 'toggleHelp'
  | 'toggleMute';

type GamepadButtonLike = {
  pressed: boolean;
  value?: number;
};

type GamepadLike = {
  buttons: ArrayLike<GamepadButtonLike>;
  connected?: boolean;
};

export interface NavigatorGamepadsLike {
  getGamepads?: () => ArrayLike<GamepadLike | null>;
}

export type RequestAnimationFrameLike = (
  callback: FrameRequestCallback,
) => number;

export type CancelAnimationFrameLike = (handle: number) => void;

export interface GameClientBrowserEventDeps {
  canvas: HTMLCanvasElement;
  helpCloseBtn: HTMLElement;
  helpBtn: HTMLElement;
  soundBtn: HTMLElement;
  getKeyboardAction: (event: KeyboardEvent) => KeyboardAction;
  getGamepadShortcut?: (control: GamepadControl) => GamepadShortcut;
  onKeyboardAction: (action: KeyboardAction) => void;
  onToggleHelp: () => void;
  onToggleSound: () => void;
  onTooltipMove: (clientX: number, clientY: number) => void;
  onTooltipLeave: () => void;
  onOffline: () => void;
  onOnline: () => void;
  documentLike?: Document;
  navigatorLike?: NavigatorGamepadsLike;
  requestAnimationFrameLike?: RequestAnimationFrameLike;
  cancelAnimationFrameLike?: CancelAnimationFrameLike;
  windowLike?: Window;
}

const GAMEPAD_BUTTON_TO_CONTROL: ReadonlyArray<
  readonly [index: number, control: GamepadControl]
> = [
  [0, 'confirm'],
  [1, 'cancel'],
  [2, 'toggleLog'],
  [3, 'focusNearestEnemy'],
  [4, 'previousShip'],
  [5, 'nextShip'],
  [8, 'toggleMute'],
  [9, 'toggleHelp'],
  [12, 'previousAttacker'],
  [13, 'nextAttacker'],
  [14, 'previousTarget'],
  [15, 'nextTarget'],
];

const isPressed = (button: GamepadButtonLike | null | undefined): boolean =>
  Boolean(button && (button.pressed || (button.value ?? 0) > 0.5));

export const bindServiceWorkerControllerReload = (
  serviceWorker: ServiceWorkerContainerLike,
  location: LocationReloadLike,
): Dispose => {
  let hadServiceWorkerController = serviceWorker.controller !== null;
  let isReloadingForServiceWorker = false;

  serviceWorker.register('/sw.js').catch(() => {});

  return listen(serviceWorker, 'controllerchange', () => {
    if (!hadServiceWorkerController) {
      hadServiceWorkerController = true;

      return;
    }

    if (isReloadingForServiceWorker) {
      return;
    }

    isReloadingForServiceWorker = true;
    location.reload();
  });
};

export const bindGameClientBrowserEvents = (
  deps: GameClientBrowserEventDeps,
): Dispose => {
  const scope = createDisposalScope();
  const documentLike = deps.documentLike ?? document;
  const navigatorLike = deps.navigatorLike ?? navigator;
  const requestAnimationFrameLike =
    deps.requestAnimationFrameLike ?? requestAnimationFrame;
  const cancelAnimationFrameLike =
    deps.cancelAnimationFrameLike ?? cancelAnimationFrame;
  const windowLike = deps.windowLike ?? window;
  let gamepadFrameId: number | null = null;
  let pressedControls = new Set<GamepadControl>();

  const dispatchAction = (action: KeyboardAction): void => {
    if (action.kind === 'none') {
      return;
    }
    deps.onKeyboardAction(action);
  };

  const dispatchGamepadShortcut = (shortcut: GamepadShortcut): void => {
    if ('directAction' in shortcut) {
      dispatchAction(shortcut.directAction);
      return;
    }

    dispatchAction(
      deps.getKeyboardAction({
        key: shortcut.key,
        shiftKey: shortcut.shiftKey ?? false,
      } as KeyboardEvent),
    );
  };

  withScope(scope, () => {
    listen(
      documentLike,
      'keydown',
      (event) => {
        const keyboardEvent = event as KeyboardEvent;

        if (
          keyboardEvent.key === 'Escape' &&
          keyboardEvent.target instanceof HTMLInputElement
        ) {
          keyboardEvent.target.blur();
          return;
        }

        const action = deps.getKeyboardAction(keyboardEvent);

        if (action.kind === 'none') {
          return;
        }

        if (action.preventDefault) {
          keyboardEvent.preventDefault();
        }
        dispatchAction(action);
      },
      { capture: true },
    );

    listen(deps.helpCloseBtn, 'click', () => deps.onToggleHelp());
    listen(deps.helpBtn, 'click', () => deps.onToggleHelp());
    listen(deps.soundBtn, 'click', () => deps.onToggleSound());
    listen(deps.canvas, 'mousemove', (event) => {
      const mouseEvent = event as MouseEvent;
      deps.onTooltipMove(mouseEvent.clientX, mouseEvent.clientY);
    });
    listen(deps.canvas, 'mouseleave', () => deps.onTooltipLeave());
    listen(windowLike, 'offline', () => deps.onOffline());
    listen(windowLike, 'online', () => deps.onOnline());

    const getGamepadShortcut = deps.getGamepadShortcut;

    if (getGamepadShortcut && typeof navigatorLike.getGamepads === 'function') {
      const pollGamepads = () => {
        const nextPressed = new Set<GamepadControl>();
        const gamepads = navigatorLike.getGamepads?.() ?? [];

        for (const gamepad of Array.from(gamepads)) {
          if (!gamepad || gamepad.connected === false) {
            continue;
          }

          for (const [index, control] of GAMEPAD_BUTTON_TO_CONTROL) {
            if (isPressed(gamepad.buttons[index])) {
              nextPressed.add(control);
              if (!pressedControls.has(control)) {
                dispatchGamepadShortcut(getGamepadShortcut(control));
              }
            }
          }
        }

        pressedControls = nextPressed;
        gamepadFrameId = requestAnimationFrameLike(pollGamepads);
      };

      gamepadFrameId = requestAnimationFrameLike(pollGamepads);
    }
  });

  return () => {
    if (gamepadFrameId !== null) {
      cancelAnimationFrameLike(gamepadFrameId);
    }
    scope.dispose();
  };
};
