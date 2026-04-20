import { describe, expect, it, vi } from 'vitest';

import type { TransferPair } from '../../shared/engine/logistics';
import { asGameId, asShipId } from '../../shared/ids';
import { buildSolarSystemMap } from '../../shared/map-data';
import type {
  FleetPurchase,
  GameState,
  PlayerId,
  Ship,
} from '../../shared/types/domain';
import { setMuted } from '../audio';
import { type CommandRouterDeps, dispatchGameCommand } from './command-router';
import {
  createLogisticsStoreFromPairs,
  type LogisticsStore,
} from './logistics-store';
import { createPlanningStore } from './planning';
import type { GameTransport } from './transport';

vi.mock('../audio', () => ({
  isMuted: () => false,
  playSelect: vi.fn(),
  setMuted: vi.fn(),
}));

const map = buildSolarSystemMap();

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
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
  gameId: asGameId('CMD'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip(),
    createShip({ id: asShipId('ship-1'), position: { q: 0, r: 0 } }),
    createShip({ id: asShipId('enemy'), owner: 1 }),
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
    submitSingleCombat: track('submitSingleCombat'),
    endCombat: track('endCombat'),
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
  target: createShip({ id: asShipId('ship-1'), position: { q: 0, r: 0 } }),
  canTransferFuel: true,
  canTransferCargo: false,
  canTransferPassengers: false,
  maxFuel: 3,
  maxCargo: 0,
  maxPassengers: 0,
});

const createLogisticsState = (amounts: number[]): LogisticsStore => {
  const pair = createTransferPair();
  const key = `${pair.source.id}->${pair.target.id}`;
  const state = createLogisticsStoreFromPairs([pair]);

  state.fuelAmounts = new Map([[key, amounts[0] ?? 0]]);
  state.cargoAmounts = new Map([[key, amounts[1] ?? 0]]);
  state.passengerAmounts = new Map([[key, amounts[2] ?? 0]]);

  return state;
};

const createDeps = (overrides?: {
  clientState?: string;
  gameState?: GameState | null;
  logisticsState?: LogisticsStore | null;
  transport?: (GameTransport & { calls: Record<string, unknown[][]> }) | null;
}): {
  deps: CommandRouterDeps;
  transport: GameTransport & { calls: Record<string, unknown[][]> };
  ui: CommandRouterDeps['ui'];
  renderer: CommandRouterDeps['renderer'];
  astrogationLogText: ReturnType<typeof vi.fn<(text: string) => void>>;
  ordnanceLogText: ReturnType<typeof vi.fn<(text: string) => void>>;
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
    getLogisticsState: () => overrides?.logisticsState ?? null,
    planningState,
  };
  const showToast = vi.fn<CommandRouterDeps['ui']['overlay']['showToast']>();
  const astrogationLogText = vi.fn<(text: string) => void>();
  const combatLogText = vi.fn<(text: string) => void>();
  const ordnanceLogText = vi.fn<(text: string) => void>();
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
      logText: astrogationLogText,
    },
    combatDeps: {
      getGameState: () => ctx.getGameState(),
      getClientState: () => ctx.getState(),
      getPlayerId: () => ctx.getPlayerId(),
      getTransport: () => ctx.getTransport(),
      getMap: () => map,
      planningState: ctx.planningState,
      showToast,
      logText: combatLogText,
    },
    ordnanceDeps: {
      getGameState: () => ctx.getGameState(),
      getClientState: () => ctx.getState(),
      getPlayerId: () => ctx.getPlayerId(),
      getMap: () => map,
      getTransport: () => ctx.getTransport(),
      planningState: ctx.planningState,
      showToast,
      logText: ordnanceLogText,
    },
    ui: {
      overlay: { showToast },
      log: { toggle: toggleLog },
    },
    renderer,
    getCanvasCenter: () => ({ x: 400, y: 300 }),
    cycleShip: vi.fn<(direction: number) => void>(),
    focusNearestEnemy: vi.fn<() => void>(),
    focusOwnFleet: vi.fn<() => void>(),
    sendFleetReady: vi.fn<(purchases: FleetPurchase[]) => void>(),
    sendSurrender: vi.fn<(shipIds: string[]) => void>(),
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
    astrogationLogText,
    ordnanceLogText,
  };
};

describe('game-command-router', () => {
  it('updates overload planning', () => {
    const { deps } = createDeps();

    dispatchGameCommand(deps, {
      type: 'setOverloadDirection',
      shipId: asShipId('ship-0'),
      direction: 3,
    });

    expect(deps.ctx.planningState.overloads.get('ship-0')).toBe(3);
  });

  it('undoes queued attacks without a toast (HUD shows queue depth)', () => {
    const { deps, ui } = createDeps();
    deps.ctx.planningState.queuedAttacks = [
      {
        attackerIds: [asShipId('ship-0')],
        targetId: asShipId('enemy'),
        targetType: 'ship',
        attackStrength: 2,
      },
      {
        attackerIds: [asShipId('ship-1')],
        targetId: asShipId('enemy'),
        targetType: 'ship',
        attackStrength: 1,
      },
    ];

    dispatchGameCommand(deps, { type: 'undoQueuedAttack' });

    expect(deps.ctx.planningState.queuedAttacks).toHaveLength(1);
    expect(ui.overlay.showToast).not.toHaveBeenCalled();
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
      logisticsState: createLogisticsState([3, 0]),
    });

    dispatchGameCommand(deps, { type: 'confirmTransfers' });

    expect(transport.calls.submitLogistics).toEqual([
      [
        [
          {
            sourceShipId: asShipId('ship-0'),
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
      logisticsState: createLogisticsState([0, 0]),
    });

    dispatchGameCommand(deps, { type: 'confirmTransfers' });

    expect(transport.calls.submitLogistics).toBeUndefined();
    expect(transport.calls.skipLogistics).toHaveLength(1);
  });

  it('selects ships and centers the camera without a selection toast', () => {
    const { deps, renderer, ui } = createDeps();

    dispatchGameCommand(deps, {
      type: 'selectShip',
      shipId: asShipId('ship-1'),
    });

    expect(deps.ctx.planningState.selectedShipId).toBe('ship-1');
    expect(deps.ctx.planningState.lastSelectedHex).toBe('0,0');
    expect(renderer.centerOnHex).toHaveBeenCalledWith({ q: 0, r: 0 });
    expect(ui.overlay.showToast).not.toHaveBeenCalled();
  });

  it('cycles combat attackers for the selected target and recenters on the attacker hex', () => {
    const { deps, renderer } = createDeps({
      clientState: 'playing_combat',
      gameState: createState({
        phase: 'combat',
        ships: [
          createShip({
            id: asShipId('ship-0'),
            type: 'corsair',
            position: { q: 0, r: 0 },
          }),
          createShip({
            id: asShipId('ship-1'),
            type: 'corvette',
            position: { q: 0, r: 0 },
          }),
          createShip({
            id: asShipId('enemy'),
            owner: 1,
            type: 'frigate',
            position: { q: 1, r: 0 },
          }),
        ],
      }),
    });
    deps.ctx.planningState.selectedShipId = 'ship-0';
    deps.ctx.planningState.combatTargetId = 'enemy';
    deps.ctx.planningState.combatTargetType = 'ship';
    deps.ctx.planningState.combatAttackerIds = ['ship-0'];
    deps.ctx.planningState.combatAttackStrength = 3;

    dispatchGameCommand(deps, { type: 'cycleCombatAttacker', direction: 1 });

    expect(deps.ctx.planningState.selectedShipId).toBe('ship-1');
    expect(deps.ctx.planningState.combatAttackerIds).toEqual(['ship-1']);
    expect(renderer.centerOnHex).toHaveBeenCalledWith({ q: 0, r: 0 });
  });

  it('clears torpedo acceleration', () => {
    const { deps } = createDeps();
    deps.ctx.planningState.torpedoAimingActive = true;
    deps.ctx.planningState.torpedoAccel = 2;
    deps.ctx.planningState.torpedoAccelSteps = 1;

    dispatchGameCommand(deps, { type: 'clearTorpedoAcceleration' });

    expect(deps.ctx.planningState.torpedoAimingActive).toBe(false);
    expect(deps.ctx.planningState.torpedoAccel).toBeNull();
    expect(deps.ctx.planningState.torpedoAccelSteps).toBeNull();
  });

  it('stores torpedo boost selection without auto-queueing the launch', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_ordnance',
      gameState: createState({ phase: 'ordnance' }),
    });
    deps.ctx.planningState.torpedoAimingActive = true;

    dispatchGameCommand(deps, {
      type: 'setTorpedoAccel',
      direction: 2,
      steps: 1,
    });

    expect(deps.ctx.planningState.torpedoAccel).toBe(2);
    expect(deps.ctx.planningState.torpedoAccelSteps).toBe(1);
    expect(transport.calls.submitOrdnance).toBeUndefined();
  });

  it('treats skipOrdnance as skip-ship until all ships are acknowledged', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_ordnance',
      gameState: createState({ phase: 'ordnance' }),
    });
    deps.ctx.planningState.selectedShipId = 'ship-0';

    dispatchGameCommand(deps, { type: 'skipOrdnance' });

    expect(deps.ctx.planningState.acknowledgedOrdnanceShips.has('ship-0')).toBe(
      true,
    );
    expect(deps.ctx.planningState.selectedShipId).toBe('ship-1');
    expect(transport.calls.submitOrdnance).toBeUndefined();
    expect(transport.calls.skipOrdnance).toBeUndefined();
  });

  it('treats skipOrdnance as confirm once all ships are acknowledged', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_ordnance',
      gameState: createState({ phase: 'ordnance' }),
    });
    deps.ctx.planningState.acknowledgedOrdnanceShips.add('ship-0');
    deps.ctx.planningState.acknowledgedOrdnanceShips.add('ship-1');

    dispatchGameCommand(deps, { type: 'skipOrdnance' });

    expect(transport.calls.skipOrdnance).toHaveLength(1);
  });

  it('keeps ordnance phase open while a legal base emplacement remains', () => {
    const { deps, transport } = createDeps({
      clientState: 'playing_ordnance',
      gameState: createState({
        phase: 'ordnance',
        scenarioRules: { allowedOrdnanceTypes: ['nuke'] },
        ships: [
          createShip({ id: asShipId('launchable'), type: 'packet' }),
          createShip({
            id: asShipId('base-carrier'),
            type: 'transport',
            position: { q: -9, r: -6 },
            velocity: { dq: 1, dr: 0 },
            cargoUsed: 50,
            baseStatus: 'carryingBase',
          }),
          createShip({ id: asShipId('enemy'), owner: 1 }),
        ],
      }),
    });
    deps.ctx.planningState.selectedShipId = 'launchable';

    dispatchGameCommand(deps, { type: 'launchOrdnance', ordType: 'nuke' });

    expect(deps.ctx.planningState.selectedShipId).toBe('base-carrier');
    expect(transport.calls.submitOrdnance).toBeUndefined();
    expect(transport.calls.skipOrdnance).toBeUndefined();
  });

  it('zooms the camera around the canvas center', () => {
    const { deps, renderer } = createDeps();

    dispatchGameCommand(deps, { type: 'zoomCamera', factor: 1.25 });

    expect(renderer.camera.zoomAt).toHaveBeenCalledWith(400, 300, 1.25);
  });

  it('toggles mute and refreshes the sound button', () => {
    const { deps } = createDeps();

    dispatchGameCommand(deps, { type: 'toggleMute' });

    expect(setMuted).toHaveBeenCalledWith(true);
    expect(deps.updateSoundButton).toHaveBeenCalledTimes(1);
  });

  it('routes rematch and exit commands through the session callbacks', () => {
    const { deps } = createDeps();

    dispatchGameCommand(deps, { type: 'requestRematch' });
    dispatchGameCommand(deps, { type: 'exitToMenu' });

    expect(deps.sendRematch).toHaveBeenCalledTimes(1);
    expect(deps.exitToMenu).toHaveBeenCalledTimes(1);
  });

  it('logs local astrogation validation errors instead of toasting them', () => {
    const { deps, ui, astrogationLogText } = createDeps({
      gameState: createState({
        ships: [
          createShip({
            id: asShipId('ship-0'),
            fuel: 0,
          }),
          createShip({ id: asShipId('enemy'), owner: 1 }),
        ],
      }),
    });
    deps.ctx.planningState.selectShip(asShipId('ship-0'));

    dispatchGameCommand(deps, {
      type: 'setBurnDirection',
      shipId: asShipId('ship-0'),
      direction: 2,
    });

    expect(astrogationLogText).toHaveBeenCalledWith('No fuel remaining');
    expect(ui.overlay.showToast).not.toHaveBeenCalled();
  });

  it('logs local ordnance validation errors instead of toasting them', () => {
    const { deps, ui, ordnanceLogText } = createDeps({
      clientState: 'playing_ordnance',
      gameState: createState({
        phase: 'ordnance',
      }),
    });
    deps.ctx.planningState.setSelectedShipId(null);

    dispatchGameCommand(deps, {
      type: 'launchOrdnance',
      ordType: 'torpedo',
    });

    expect(ordnanceLogText).toHaveBeenCalledWith('Select a ship first');
    expect(ui.overlay.showToast).not.toHaveBeenCalled();
  });
});
