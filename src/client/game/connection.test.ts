// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { type ConnectionDeps, createConnectionManager } from './connection';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const createDeps = () => {
  const state = createGame(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    'CONN1',
    findBaseHex,
  );
  let clientState: ConnectionDeps['getClientState'] extends () => infer T
    ? T
    : never = 'playing_astrogation';
  const setReconnectAttempts = vi.fn<ConnectionDeps['setReconnectAttempts']>();
  const setTransport = vi.fn<ConnectionDeps['setTransport']>();
  const setLatencyMs = vi.fn<ConnectionDeps['setLatencyMs']>();
  const setState = vi.fn<ConnectionDeps['setState']>();
  const handleMessage = vi.fn<ConnectionDeps['handleMessage']>();
  const showReconnecting = vi.fn<ConnectionDeps['showReconnecting']>();
  const hideReconnecting = vi.fn<ConnectionDeps['hideReconnecting']>();
  const showToast = vi.fn<ConnectionDeps['showToast']>();
  const exitToMenu = vi.fn<ConnectionDeps['exitToMenu']>();
  const deps: ConnectionDeps = {
    getGameCode: () => 'ABCDE',
    getGameState: () => state,
    getClientState: () => clientState,
    getStoredPlayerToken: () => null,
    getReconnectAttempts: () => 0,
    setReconnectAttempts,
    setTransport,
    setLatencyMs,
    setState,
    handleMessage,
    showReconnecting,
    hideReconnecting,
    showToast,
    exitToMenu,
  };

  return {
    deps,
    setClientState: (state: typeof clientState) => {
      clientState = state;
    },
    spies: {
      setReconnectAttempts,
      setTransport,
      setLatencyMs,
      setState,
      handleMessage,
      showReconnecting,
      hideReconnecting,
      showToast,
      exitToMenu,
    },
  };
};

describe('game-client-connection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not treat an intentional close as a reconnectable disconnect', () => {
    const { deps, spies } = createDeps();
    const manager = createConnectionManager(deps);

    manager.connect('ABCDE');
    manager.close();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(spies.showReconnecting).not.toHaveBeenCalled();
    expect(spies.setState).not.toHaveBeenCalled();
    expect(spies.exitToMenu).not.toHaveBeenCalled();
  });

  it('cancels any scheduled reconnect when closing intentionally', () => {
    vi.useFakeTimers();
    let reconnectAttempts = 0;
    const { deps, spies } = createDeps();
    deps.getReconnectAttempts = () => reconnectAttempts;
    deps.setReconnectAttempts = vi.fn<ConnectionDeps['setReconnectAttempts']>(
      (value) => {
        reconnectAttempts = value;
      },
    );
    const manager = createConnectionManager(deps);

    manager.attemptReconnect();
    manager.close();
    vi.runAllTimers();

    expect(spies.showReconnecting).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('routes reconnect give-up through shared session teardown', () => {
    const { deps, spies } = createDeps();
    deps.getReconnectAttempts = () => 5;
    const manager = createConnectionManager(deps);

    manager.attemptReconnect();

    expect(spies.hideReconnecting).toHaveBeenCalledTimes(1);
    expect(spies.showToast).toHaveBeenCalledWith(
      'Could not reconnect to game',
      'error',
    );
    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
    expect(spies.setState).not.toHaveBeenCalled();
  });

  it('routes reconnect cancel through shared session teardown', () => {
    vi.useFakeTimers();
    const { deps, spies } = createDeps();
    const manager = createConnectionManager(deps);

    manager.attemptReconnect();

    expect(spies.showReconnecting).toHaveBeenCalledTimes(1);
    const onCancel = spies.showReconnecting.mock.calls[0][2] as () => void;
    onCancel();

    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
    expect(spies.setState).not.toHaveBeenCalled();
  });

  it('does not reconnect after an initial connect failure', () => {
    const { deps, setClientState, spies } = createDeps();
    setClientState('connecting');
    const manager = createConnectionManager(deps);

    manager.handleDisconnect();

    expect(spies.showReconnecting).not.toHaveBeenCalled();
    expect(spies.showToast).toHaveBeenCalledWith(
      'Could not connect to game',
      'error',
    );
    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
  });
});
