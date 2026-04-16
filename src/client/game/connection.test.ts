// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { type ConnectionDeps, createConnectionManager } from './connection';

type FakeWebSocketInstance = {
  url: string;
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: (() => void) | null;
  sent: string[];
  send: (payload: string) => void;
  close: (ev?: Partial<CloseEvent>) => void;
};

type FakeWebSocketCtor = {
  new (url: string): FakeWebSocketInstance;
  OPEN: number;
  instances: FakeWebSocketInstance[];
  prototype: {
    send: (this: FakeWebSocketInstance, payload: string) => void;
    close: (this: FakeWebSocketInstance) => void;
  };
};

const createFakeWebSocketCtor = (): FakeWebSocketCtor => {
  const instances: FakeWebSocketInstance[] = [];
  const FakeWebSocket = function FakeWebSocket(
    this: FakeWebSocketInstance,
    url: string,
  ) {
    this.url = url;
    this.readyState = 1;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.sent = [];
    instances.push(this);
  } as unknown as FakeWebSocketCtor;

  FakeWebSocket.OPEN = 1;
  FakeWebSocket.instances = instances;
  FakeWebSocket.prototype.send = function send(
    this: FakeWebSocketInstance,
    payload: string,
  ) {
    this.sent.push(payload);
  };
  FakeWebSocket.prototype.close = function close(
    this: FakeWebSocketInstance,
    ev?: Partial<CloseEvent>,
  ) {
    this.readyState = 3;
    const event = {
      code: ev?.code ?? 1000,
      reason: ev?.reason ?? '',
      wasClean: ev?.wasClean ?? true,
    } as CloseEvent;
    this.onclose?.(event);
  };

  return FakeWebSocket;
};

const FakeWebSocket = createFakeWebSocketCtor();

const createDeps = () => {
  const state = createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('CONN1'),
    findBaseHex,
  );
  let clientState: ConnectionDeps['getClientState'] extends () => infer T
    ? T
    : never = 'playing_astrogation';
  const setReconnectAttempts = vi.fn<ConnectionDeps['setReconnectAttempts']>();
  const setTransport = vi.fn<ConnectionDeps['setTransport']>();
  const setLatencyMs = vi.fn<ConnectionDeps['setLatencyMs']>();
  const setReconnectOverlayState =
    vi.fn<ConnectionDeps['setReconnectOverlayState']>();
  const setState = vi.fn<ConnectionDeps['setState']>();
  const handleMessage = vi.fn<ConnectionDeps['handleMessage']>();
  const showToast = vi.fn<ConnectionDeps['showToast']>();
  const exitToMenu = vi.fn<ConnectionDeps['exitToMenu']>();
  const trackEvent = vi.fn<ConnectionDeps['trackEvent']>();
  const deps: ConnectionDeps = {
    getGameCode: () => 'ABCDE',
    getGameState: () => state,
    getClientState: () => clientState,
    isSpectatorSession: () => false,
    getStoredPlayerToken: () => null,
    getReconnectAttempts: () => 0,
    setReconnectAttempts,
    setTransport,
    setLatencyMs,
    setReconnectOverlayState,
    setState,
    handleMessage,
    showToast,
    exitToMenu,
    trackEvent,
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
      setReconnectOverlayState,
      setState,
      handleMessage,
      showToast,
      exitToMenu,
      trackEvent,
    },
  };
};

describe('game-client-connection', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens spectator websockets with viewer=spectator and no player token', () => {
    const { deps } = createDeps();
    deps.isSpectatorSession = () => true;
    const manager = createConnectionManager(deps);

    manager.connect('ABCDE');

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toContain('viewer=spectator');
    expect(FakeWebSocket.instances[0]?.url).not.toContain('playerToken');
  });

  it('validates inbound messages and rejects malformed payloads', () => {
    const { deps, spies } = createDeps();
    const manager = createConnectionManager(deps);

    manager.connect('ABCDE');
    const ws = FakeWebSocket.instances[0];

    // Valid message is forwarded
    ws.onmessage?.({ data: JSON.stringify({ type: 'pong', t: 1000 }) });
    expect(spies.handleMessage).toHaveBeenCalledTimes(1);

    // Malformed JSON is dropped
    ws.onmessage?.({ data: 'not-json' });
    expect(spies.handleMessage).toHaveBeenCalledTimes(1);
    expect(spies.trackEvent).toHaveBeenCalledWith('ws_parse_error');

    // Unknown message type is dropped
    ws.onmessage?.({ data: JSON.stringify({ type: 'godMode' }) });
    expect(spies.handleMessage).toHaveBeenCalledTimes(1);
    expect(spies.trackEvent).toHaveBeenCalledWith('ws_invalid_message', {
      error: 'Unknown message type: godMode',
    });
  });

  it('does not treat an intentional close as a reconnectable disconnect', () => {
    const { deps, spies } = createDeps();
    const manager = createConnectionManager(deps);

    manager.connect('ABCDE');
    manager.close();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(spies.setReconnectOverlayState).toHaveBeenCalledWith(null);
    expect(spies.setState).not.toHaveBeenCalled();
    expect(spies.exitToMenu).not.toHaveBeenCalled();
  });

  it('restarts ping without leaving duplicate intervals behind', () => {
    vi.useFakeTimers();
    const { deps, spies } = createDeps();
    const manager = createConnectionManager(deps);

    manager.connect('ABCDE');
    const ws = FakeWebSocket.instances[0];
    ws.sent.length = 0;
    spies.setLatencyMs.mockClear();

    manager.startPing();
    vi.advanceTimersByTime(5000);

    expect(spies.setLatencyMs).toHaveBeenCalledWith(-1);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0] ?? 'null')).toMatchObject({ type: 'ping' });
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

    expect(spies.setReconnectOverlayState).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('routes reconnect give-up through shared session teardown', () => {
    const { deps, spies } = createDeps();
    deps.getReconnectAttempts = () => 5;
    const manager = createConnectionManager(deps);

    manager.attemptReconnect();

    expect(spies.setReconnectOverlayState).toHaveBeenLastCalledWith(null);
    expect(spies.showToast).toHaveBeenCalledWith(
      'Could not reconnect to game',
      'error',
    );
    expect(spies.trackEvent).toHaveBeenCalledWith('reconnect_failed', {
      attempts: 5,
    });
    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
    expect(spies.setState).not.toHaveBeenCalled();
  });

  it('tracks scheduled reconnect attempts', () => {
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

    expect(spies.trackEvent).toHaveBeenCalledWith(
      'reconnect_attempt_scheduled',
      {
        attempt: 1,
        delayMs: 1000,
      },
    );
    expect(spies.setReconnectOverlayState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 5,
      }),
    );
  });

  it('routes reconnect cancel through shared session teardown', () => {
    vi.useFakeTimers();
    const { deps, spies } = createDeps();
    const manager = createConnectionManager(deps);

    manager.attemptReconnect();

    expect(spies.setReconnectOverlayState).toHaveBeenCalledTimes(1);
    const onCancel = spies.setReconnectOverlayState.mock.calls[0][0] as {
      onCancel: () => void;
    } | null;
    expect(onCancel).not.toBeNull();
    onCancel?.onCancel();
    vi.runAllTimers();

    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
    expect(spies.setReconnectOverlayState).toHaveBeenLastCalledWith(null);
    expect(spies.setState).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('does not reconnect after an initial connect failure', () => {
    const { deps, setClientState, spies } = createDeps();
    setClientState('connecting');
    const manager = createConnectionManager(deps);

    manager.handleDisconnect();

    expect(spies.setReconnectOverlayState).not.toHaveBeenCalled();
    expect(spies.showToast).toHaveBeenCalledWith(
      'Could not connect to game',
      'error',
    );
    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
  });

  it('emits telemetry and a clearer toast when the socket closes abnormally during connect', () => {
    const { deps, setClientState, spies } = createDeps();
    setClientState('connecting');
    const manager = createConnectionManager(deps);

    manager.connect('ABCDE');
    const ws = FakeWebSocket.instances[0];
    ws.close({ code: 1006, wasClean: false, reason: '' });

    expect(spies.trackEvent).toHaveBeenCalledWith('ws_connect_closed', {
      code: 1006,
      wasClean: false,
      reasonLen: 0,
    });
    expect(spies.showToast).toHaveBeenCalledWith(
      'Could not reach game server',
      'error',
    );
    expect(spies.exitToMenu).toHaveBeenCalledTimes(1);
  });
});
