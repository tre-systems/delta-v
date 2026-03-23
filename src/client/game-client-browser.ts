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

export interface GameClientBrowserEventDeps {
  canvas: HTMLCanvasElement;
  helpCloseBtn: HTMLElement;
  helpBtn: HTMLElement;
  soundBtn: HTMLElement;
  getKeyboardAction: (event: KeyboardEvent) => KeyboardAction;
  onKeyboardAction: (action: KeyboardAction) => void;
  onToggleHelp: () => void;
  onToggleSound: () => void;
  onTooltipMove: (clientX: number, clientY: number) => void;
  onTooltipLeave: () => void;
  onOffline: () => void;
  onOnline: () => void;
  documentLike?: Document;
  windowLike?: Window;
}

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
  const windowLike = deps.windowLike ?? window;

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
        deps.onKeyboardAction(action);
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
  });

  return () => scope.dispose();
};
