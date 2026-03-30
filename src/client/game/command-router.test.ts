import { describe, expect, it, vi } from 'vitest';

import type { TransferPair } from '../../shared/engine/logistics';
import { buildSolarSystemMap } from '../../shared/map-data';
import type {
  FleetPurchase,
  GameState,
  PlayerId,
  Ship,
} from '../../shared/types/domain';
import { type CommandRouterDeps, dispatchGameCommand } from './command-router';
import type { LogisticsUIState } from './logistics-ui';
import { createPlanningStore } from './planning';
import type { GameTransport } from './transport';

vi.mock('../audio', () => ({
  isMuted: () => false,
  playSelect: vi.fn(),
  setMuted: vi.fn(),
}));

const map = buildSolarSystemMap();

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'CMD',
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip(),
    createShip({ id: 'ship-1', position: { q: 0, r: 0 } }),
    createShip({ id: 'enemy', owner: 1 }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: 'Mars',
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Terra',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
  ...overrides,
});

const mockTransport = (): GameTransport & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) {
        calls[name] = [];
      }
      calls[name].push(args);
    };

  return {
    submitAstrogation: track('submitAstrogation'),
    submitCombat: track('submitCombat'),
    submitOrdnance: track('submitOrdnance'),
    submitEmplacement: track('submitEmplacement'),
    submitFleetReady: track('submitFleetReady'),
    submitLogistics: track('submitLogistics'),
    submitSurrender: track('submitSurrender'),
    skipOrdnance: track('skipOrdnance'),
    skipCombat: track('skipCombat'),
    skipLogistics: track('skipLogistics'),
    beginCombat: track('beginCombat'),
    requestRematch: track('requestRematch'),
    sendChat: track('sendChat'),
    calls,
  };
};

const createTransferPair = (): TransferPair => ({
  source: createShip(),
  target: createShip({ id: 'ship-1', position: { q: 0, r: 0 } }),
  canTransferFuel: true,
  canTransferCargo: false,
  canTransferPassengers: false,
  maxFuel: 3,
  maxCargo: 0,
  maxPassengers: 0,
});

const createLogisticsState = (amounts: number[]): LogisticsUIState => {
  const pair = createTransferPair();
  const key = `${pair.source.id}->${pair.target.id}`;

  return {
    pairs: [pair],
    fuelAmounts: new Map([[key, amounts[0] ?? 0]]),
    cargoAmounts: new Map([[key, amounts[1] ?? 0]]),
    passengerAmounts: new Map([[key, amounts[2] ?? 0]]),
  };
};

const createDeps = (overrides?: {
  clientState?: string;
  gameState?: GameState | null;
  logisticsUIState?: LogisticsUIState | null;
  transport?: (GameTransport & { calls: Record<string, unknown[][]> }) | null;
}): {
  deps: CommandRouterDeps;
  transport: GameTransport & { calls: Record<string, unknown[][]> };
  ui: CommandRouterDeps['ui'];
  renderer: CommandRouterDeps['renderer'];
} => {
  const planningState = createPlanningStore();
  const transport = overrides?.transport ?? mockTransport();
  const clientState = overrides?.clientState ?? 'playing_astrogation';
  const gameState = overrides?.gameState ?? createState();
  const ctx: CommandRouterDeps['ctx'] = {
    getState: () =>
      clientState as ReturnType<CommandRouterDeps['ctx']['getState']>,
    getPlayerId: () => 0 as PlayerId,
    getGameState: () => gameState,
    getTransport: () => transport,
    planningState,
  };
  const showAttackButton = vi.fn<CommandRouterDeps['ui']['showAttackButton']>();
  const showFireButton = vi.fn<CommandRouterDeps['ui']['showFireButton']>();
  const showToast = vi.fn<CommandRouterDeps['ui']['overlay']['showToast']>();
  const toggleLog = vi.fn<CommandRouterDeps['ui']['log']['toggle']>();
  const renderer = {
    centerOnHex: vi.fn<(position: { q: number; r: number }) => void>(),
    camera: {
      pan: vi.fn<(dx: number, dy: number) => void>(),
      zoomAt: vi.fn<(x: number, y: number, factor: number) => void>(),
    },
  };
  const deps: CommandRouterDeps = {
    ctx,
    astrogationDeps: {
      getGameState: () => ctx.getGameState(),
      getClientState: () => ctx.getState(),
      getPlayerId: () => ctx.getPlayerId(),
      getTransport: () => ctx.getTransport(),
      planningState: ctx.planningState,
      showToast,
    },
    combatDeps: {
      getGameState: () => ctx.getGameState(),
      getClientState: () => ctx.getState(),
      getPlayerId: () => ctx.getPlayerId(),
      getTransport: () => ctx.getTransport(),
      getMap: () => map,
      planningState: ctx.planningState,
      showToast,
      showAttackButton,
      showFireButton,
    },
    ordnanceDeps: {
      getGameState: () => ctx.getGameState(),
      getClientState: () => ctx.getState(),
      getTransport: () => ctx.getTransport(),
      planningState: ctx.planningState,
      showToast,
      logText: vi.fn<(text: string) => void>(),
    },
    logisticsUIState: overrides?.logisticsUIState ?? null,
    ui: {
      showAttackButton,
      showFireButton,
      overlay: { showToast },
      log: { toggle: toggleLog },
    },
    renderer,
    getCanvasCenter: () => ({ x: 400, y: 300 }),
    cycleShip: vi.fn<(direction: number) => void>(),
    focusNearestEnemy: vi.fn<() => void>(),
    focusOwnFleet: vi.fn<() => void>(),
    sendFleetReady: vi.fn<(purchases: FleetPurchase[]) => void>(),
    sendRematch: vi.fn<() => void>(),
    exitToMenu: vi.fn<() => void>(),
    toggleHelp: vi.fn<() => void>(),
    updateSoundButton: vi.fn<() => void>(),
  };

  return {
    deps,
    transport,
    ui: deps.ui,
    renderer: deps.renderer,
  };
};

describe('game-command-router', () => {
  it('updates overload planning', () => {
    const { deps } = createDeps();

    dispatchGameCommand(deps, {
      type: 'setOverloadDirection',
      shipId: 'ship-0',
      direction: 3,
    });

    expect(deps.ctx.planningState.overloads.get('ship-0')).toBe(3);
  });

  it('matches nearby friendly velocity', () => {
    const { deps, ui } = createDeps({
      gameState: createState({
        ships: [
          createShip({
            id: 'ship-0',
            type: 'packet',
            velocity: { dq: 0, dr: 0 },
          }),
          createShip({
            id: 'ship-1',
            owner: 0,
            position: { q: 1, r: 0 },
            velocity: { dq: 1, dr: 0 },
          }),
          createShip({ id: 'enemy', owner: 1 }),
        ],
      }),
    });
    deps.ctx.planningState.selectedShipId = 'ship-0';

    dispatchGameCommand(deps, { type: 'matchVelocity' });

    expect(deps.ctx.planningState.burns.get('ship-0')).toBe(0);
    expect(deps.ctx.planningState.overloads.get('ship-0')).toBeNull();
    expect(ui.overlay.showToast).toHaveBeenCalledWith(
      'Matching velocity with ship-1',
      'success',
    );
  });

  it('undoes queued attacks and updates fire button state', () => {
    const { deps, ui } = createDeps();
    deps.ctx.planningState.queuedAttacks = [
      {
        attackerIds: ['ship-0'],
        targetId: 'enemy',
        targetType: 'ship',
        attackStrength: 2,
      },
      {
        attackerIds: ['ship-1'],
        targetId: 'enemy',
        targetType: 'ship',
        attackStrength: 1,
      },
    ];

    dispatchGameCommand(deps, { type: 'undoQueuedAttack' });

    expect(deps.ctx.planningState.queuedAttacks).toHaveLength(1);
    expect(ui.showFireButton).toHaveBeenCalledWith(true, 1);
    expect(ui.overlay.showToast).toHaveBeenCalledWith(
      'Undid last attack (1 queued)',
      'info',
    );
  });

  it('guards skipLogistics by client state', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_logistics',
    });

    dispatchGameCommand(deps, { type: 'skipLogistics' });

    expect(transport.calls.skipLogistics).toHaveLength(1);
  });

  it('submits logistics orders when transfers are queued', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_logistics',
      logisticsUIState: createLogisticsState([3, 0]),
    });

    dispatchGameCommand(deps, { type: 'confirmTransfers' });

    expect(transport.calls.submitLogistics).toEqual([
      [
        [
          {
            sourceShipId: 'ship-0',
            targetShipId: 'ship-1',
            transferType: 'fuel',
            amount: 3,
          },
        ],
      ],
    ]);
    expect(transport.calls.skipLogistics).toBeUndefined();
  });

  it('falls back to skipLogistics when no transfers are queued', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_logistics',
      logisticsUIState: createLogisticsState([0, 0]),
    });

    dispatchGameCommand(deps, { type: 'confirmTransfers' });

    expect(transport.calls.submitLogistics).toBeUndefined();
    expect(transport.calls.skipLogistics).toHaveLength(1);
  });

  it('selects ships, centers the camera, and shows a toast for multiple ships', () => {
    const { deps, renderer, ui } = createDeps();

    dispatchGameCommand(deps, {
      type: 'selectShip',
      shipId: 'ship-1',
    });

    expect(deps.ctx.planningState.selectedShipId).toBe('ship-1');
    expect(deps.ctx.planningState.lastSelectedHex).toBe('0,0');
    expect(renderer.centerOnHex).toHaveBeenCalledWith({ q: 0, r: 0 });
    expect(ui.overlay.showToast).toHaveBeenCalledWith(
      'Selected: Packet',
      'info',
    );
  });

  it('clears torpedo acceleration', () => {
    const { deps } = createDeps();
    deps.ctx.planningState.torpedoAccel = 2;
    deps.ctx.planningState.torpedoAccelSteps = 1;

    dispatchGameCommand(deps, { type: 'clearTorpedoAcceleration' });

    expect(deps.ctx.planningState.torpedoAccel).toBeNull();
    expect(deps.ctx.planningState.torpedoAccelSteps).toBeNull();
  });
});
