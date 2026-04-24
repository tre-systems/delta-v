import { must } from '../../shared/assert';
import { validateServerMessage } from '../../shared/protocol';
import type { GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { getConnectCloseToastMessage } from '../messages/server-error-presentation';
import { TOAST } from '../messages/toasts';
import { deriveReconnectAttemptPlan } from './network';
import type { ClientState } from './phase';
import { buildWebSocketUrl } from './session-links';
import type { ReconnectOverlayState } from './session-ui-state';
import { createWebSocketTransport, type GameTransport } from './transport';
export interface ConnectionDeps {
  getGameCode: () => string | null;
  getGameState: () => GameState | null;
  getClientState: () => ClientState;
  isSpectatorSession: () => boolean;
  getStoredPlayerToken: (code: string) => string | null;
  getReconnectAttempts: () => number;
  setReconnectAttempts: (n: number) => void;
  setTransport: (t: GameTransport) => void;
  setLatencyMs: (ms: number) => void;
  setReconnectOverlayState: (state: ReconnectOverlayState | null) => void;
  setState: (state: ClientState) => void;
  handleMessage: (msg: S2C) => void;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  exitToMenu: () => void;
  trackEvent: (event: string, props?: Record<string, unknown>) => void;
  webSocketCtor: typeof WebSocket;
}

export interface ConnectionManager {
  connect: (code: string) => void;
  send: (msg: unknown) => void;
  startPing: () => void;
  stopPing: () => void;
  attemptReconnect: () => void;
  handleDisconnect: () => void;
  close: () => void;
  getWs: () => WebSocket | null;
}

interface ConnectionRuntime {
  ws: WebSocket | null;
  pingInterval: number | null;
  reconnectTimer: number | null;
  suppressDisconnectHandling: boolean;
  /** Last WebSocket close from the active transport (for UX + telemetry). */
  lastClose: { code: number; reason: string; wasClean: boolean } | null;
}

const PING_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 5;

const clearPingInterval = (
  runtime: Pick<ConnectionRuntime, 'pingInterval'>,
): void => {
  if (runtime.pingInterval !== null) {
    clearInterval(runtime.pingInterval);
    runtime.pingInterval = null;
  }
};

const clearReconnectTimer = (
  runtime: Pick<ConnectionRuntime, 'reconnectTimer'>,
): void => {
  if (runtime.reconnectTimer !== null) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
};

const parseServerPayload = (
  payload: string,
  deps: Pick<ConnectionDeps, 'trackEvent'>,
): S2C | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    deps.trackEvent('ws_parse_error');
    return null;
  }
  const result = validateServerMessage(parsed);
  if (!result.ok) {
    deps.trackEvent('ws_invalid_message', { error: result.error });
    return null;
  }
  return result.value;
};

export const createConnectionManager = (
  deps: ConnectionDeps,
): ConnectionManager => {
  const WebSocketCtor = deps.webSocketCtor;
  const runtime: ConnectionRuntime = {
    ws: null,
    pingInterval: null,
    reconnectTimer: null,
    suppressDisconnectHandling: false,
    lastClose: null,
  };

  const send = (msg: unknown) => {
    if (runtime.ws?.readyState === WebSocketCtor.OPEN) {
      runtime.ws.send(JSON.stringify(msg));
    }
  };

  const stopPing = () => {
    clearPingInterval(runtime);
    deps.setLatencyMs(-1);
  };

  const startPing = () => {
    stopPing();
    runtime.pingInterval = window.setInterval(() => {
      if (runtime.ws?.readyState === WebSocketCtor.OPEN) {
        const sentAt = Date.now();
        send({ type: 'ping', t: sentAt });
      }
    }, PING_INTERVAL_MS);
  };

  const clearReconnectUi = () => {
    deps.setReconnectOverlayState(null);
  };

  const clearReconnectFlow = () => {
    clearReconnectTimer(runtime);
    clearReconnectUi();
  };

  const exitReconnectFlow = () => {
    clearReconnectFlow();
    deps.exitToMenu();
  };

  const handleSocketMessage = (payload: string) => {
    const message = parseServerPayload(payload, deps);
    if (message) {
      deps.handleMessage(message);
    }
  };

  const attemptReconnect = () => {
    const reconnectAttempts = deps.getReconnectAttempts();
    const plan = deriveReconnectAttemptPlan(
      deps.getGameCode(),
      reconnectAttempts,
      MAX_RECONNECT_ATTEMPTS,
    );

    if (plan.giveUp) {
      deps.trackEvent('reconnect_failed', {
        attempts: reconnectAttempts,
      });
      clearReconnectFlow();
      deps.showToast(TOAST.connection.couldNotReconnect, 'error');
      deps.exitToMenu();
      return;
    }

    const attempt = must(plan.nextAttempt);
    const delayMs = must(plan.delayMs);

    deps.setReconnectAttempts(attempt);
    deps.trackEvent('reconnect_attempt_scheduled', {
      attempt,
      delayMs,
    });
    deps.setReconnectOverlayState({
      attempt,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      onCancel: () => {
        exitReconnectFlow();
      },
    });
    runtime.reconnectTimer = window.setTimeout(() => {
      runtime.reconnectTimer = null;
      connect(must(deps.getGameCode()));
    }, delayMs);
  };

  const connectFailureToast = (): void => {
    const close = runtime.lastClose;
    deps.trackEvent('ws_connect_closed', {
      code: close?.code ?? null,
      wasClean: close?.wasClean ?? null,
      reasonLen: close?.reason?.length ?? 0,
    });
    if (!close || close.code === 1000) {
      deps.showToast(TOAST.connection.couldNotConnect, 'error');
      return;
    }
    deps.showToast(
      getConnectCloseToastMessage(close.code, close.reason),
      'error',
    );
  };

  const handleDisconnect = () => {
    stopPing();
    const currentState = deps.getClientState();
    const canReconnect =
      currentState !== 'menu' &&
      currentState !== 'gameOver' &&
      currentState !== 'connecting' &&
      Boolean(deps.getGameCode());

    if (canReconnect) {
      attemptReconnect();
      return;
    }

    if (currentState === 'menu' || currentState === 'gameOver') {
      return;
    }

    // Otherwise we were mid-flow without a reconnect target (menu-bound);
    // surface the connecting-failure toast and route back to the menu.
    if (currentState === 'connecting') {
      connectFailureToast();
    }
    deps.exitToMenu();
  };

  const handleSocketClose = (socket: WebSocket, ev: CloseEvent) => {
    if (runtime.ws !== socket) {
      return;
    }
    runtime.ws = null;
    runtime.lastClose = {
      code: ev.code,
      reason: ev.reason,
      wasClean: ev.wasClean,
    };

    const shouldHandleDisconnect = !runtime.suppressDisconnectHandling;
    runtime.suppressDisconnectHandling = false;

    if (shouldHandleDisconnect) {
      handleDisconnect();
    }
  };

  const connect = (code: string) => {
    runtime.suppressDisconnectHandling = false;
    runtime.lastClose = null;
    const spectator = deps.isSpectatorSession();
    const previousSocket = runtime.ws;
    const socket = new WebSocketCtor(
      buildWebSocketUrl(
        location,
        code,
        spectator ? null : deps.getStoredPlayerToken(code),
        spectator ? { viewer: 'spectator' } : undefined,
      ),
    );
    runtime.ws = socket;
    previousSocket?.close();
    socket.onmessage = (e) => {
      handleSocketMessage(e.data);
    };
    socket.onclose = (ev) => {
      handleSocketClose(socket, ev);
    };
    socket.onerror = () => {
      deps.trackEvent('ws_connect_error');
    };
    deps.setTransport(createWebSocketTransport((msg) => send(msg)));
    startPing();
  };

  const close = () => {
    runtime.suppressDisconnectHandling = true;
    stopPing();
    clearReconnectFlow();
    runtime.ws?.close();
    runtime.ws = null;
  };

  return {
    connect,
    send,
    startPing,
    stopPing,
    attemptReconnect,
    handleDisconnect,
    close,
    getWs: () => runtime.ws,
  };
};
