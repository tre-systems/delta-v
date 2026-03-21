import { must } from '../../shared/assert';
import type { GameState, S2C } from '../../shared/types';
import {
  deriveDisconnectHandling,
  deriveReconnectAttemptPlan,
} from './network';
import type { ClientState } from './phase';
import { buildWebSocketUrl } from './session';
import { createWebSocketTransport, type GameTransport } from './transport';
export interface ConnectionDeps {
  getGameCode: () => string | null;
  getGameState: () => GameState | null;
  getClientState: () => ClientState;
  getStoredPlayerToken: (code: string) => string | null;
  getReconnectAttempts: () => number;
  setReconnectAttempts: (n: number) => void;
  setTransport: (t: GameTransport) => void;
  setLatencyMs: (ms: number) => void;
  setState: (state: ClientState) => void;
  handleMessage: (msg: S2C) => void;
  showReconnecting: (
    attempt: number,
    max: number,
    onCancel: () => void,
  ) => void;
  hideReconnecting: () => void;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
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
const MAX_RECONNECT_ATTEMPTS = 5;
export const createConnectionManager = (
  deps: ConnectionDeps,
): ConnectionManager => {
  let ws: WebSocket | null = null;
  let pingInterval: number | null = null;
  let lastPingSent = 0;
  let reconnectTimer: number | null = null;
  let suppressDisconnectHandling = false;
  const send = (msg: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };
  const stopPing = () => {
    if (pingInterval !== null) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    deps.setLatencyMs(-1);
  };
  const startPing = () => {
    stopPing();
    deps.setLatencyMs(-1);
    pingInterval = window.setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        lastPingSent = Date.now();
        send({ type: 'ping', t: lastPingSent });
      }
    }, 5000);
  };
  const connect = (code: string) => {
    suppressDisconnectHandling = false;
    ws = new WebSocket(
      buildWebSocketUrl(location, code, deps.getStoredPlayerToken(code)),
    );
    ws.onmessage = (e) => deps.handleMessage(JSON.parse(e.data));
    ws.onclose = () => {
      const shouldHandleDisconnect = !suppressDisconnectHandling;
      suppressDisconnectHandling = false;
      if (shouldHandleDisconnect) {
        handleDisconnect();
      }
    };
    ws.onerror = () => {}; // onclose fires after onerror
    deps.setTransport(createWebSocketTransport((msg) => send(msg)));
    startPing();
  };
  const attemptReconnect = () => {
    const plan = deriveReconnectAttemptPlan(
      deps.getGameCode(),
      deps.getReconnectAttempts(),
      MAX_RECONNECT_ATTEMPTS,
    );
    if (plan.giveUp) {
      deps.hideReconnecting();
      deps.showToast('Could not reconnect to game', 'error');
      deps.setState('menu');
      return;
    }
    deps.setReconnectAttempts(must(plan.nextAttempt));
    deps.showReconnecting(
      must(plan.nextAttempt),
      MAX_RECONNECT_ATTEMPTS,
      () => {
        // Cancel reconnection and return to menu
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        deps.setReconnectAttempts(0);
        deps.setState('menu');
      },
    );
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect(must(deps.getGameCode()));
    }, must(plan.delayMs));
  };
  const handleDisconnect = () => {
    stopPing();
    const handling = deriveDisconnectHandling(
      deps.getClientState(),
      deps.getGameCode(),
      deps.getGameState(),
    );
    if (handling.attemptReconnect) {
      attemptReconnect();
      return;
    }
    if (handling.nextState) {
      deps.setState(handling.nextState);
    }
  };
  const close = () => {
    suppressDisconnectHandling = true;
    stopPing();
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  };
  return {
    connect,
    send,
    startPing,
    stopPing,
    attemptReconnect,
    handleDisconnect,
    close,
    getWs: () => ws,
  };
};
