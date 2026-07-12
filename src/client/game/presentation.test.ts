import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexKey } from '../../shared/hex';
import { asGameId, asShipId } from '../../shared/ids';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  PlayerId,
  Ship,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  playCombat,
  playDamage,
  playExplosion,
  playLanding,
  playOrdnanceImpact,
  playThrust,
  playTrajectory,
} from '../audio';
import {
  type PresentationDeps,
  presentCombatResults,
  presentMovementResult,
  showGameOverOutcome,
} from './presentation';

vi.mock('../audio', () => ({
  playCapture: vi.fn(),
  playCombat: vi.fn(),
  playCollision: vi.fn(),
  playDamage: vi.fn(),
  playDefeat: vi.fn(),
  playExplosion: vi.fn(),
  playLanding: vi.fn(),
  playOrdnanceImpact: vi.fn(),
  playThrust: vi.fn(),
  playTrajectory: vi.fn(),
  playVictory: vi.fn(),
}));

const map: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 4 },
};

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
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('PRES'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: asShipId('enemy'), owner: 1 })],
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

const createMovement = (overrides: Partial<ShipMovement> = {}): ShipMovement =>
  ({
    shipId: asShipId('ship-0'),
    from: { q: 0, r: 0 },
    to: { q: 1, r: 0 },
    path: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ],
    newVelocity: { dq: 1, dr: 0 },
    fuelSpent: 0,
    gravityEffects: [],
    outcome: 'normal',
    ...overrides,
  }) as ShipMovement;

const createMovementEvent = (
  overrides: Partial<MovementEvent> = {},
): MovementEvent => ({
  type: 'torpedoHit',
  shipId: asShipId('ship-0'),
  hex: { q: 1, r: 0 },
  dieRoll: 4,
  damageType: 'disabled',
  disabledTurns: 2,
  ...overrides,
});

const createCombatResult = (
  overrides: Partial<CombatResult> = {},
): CombatResult => ({
  attackerIds: [asShipId('ship-0')],
  targetId: asShipId('enemy'),
  targetType: 'ship',
  attackType: 'gun',
  odds: '1:1',
  attackStrength: 1,
  defendStrength: 1,
  rangeMod: 0,
  velocityMod: 0,
  dieRoll: 4,
  modifiedRoll: 4,
  damageType: 'none',
  disabledTurns: 0,
  counterattack: null,
  ...overrides,
});

const createDeps = (state: GameState): PresentationDeps => ({
  applyGameState: vi.fn(),
  setState: vi.fn(),
  resetCombatState: vi.fn(),
  getGameState: () => state,
  getClientState: () => 'gameOver' as const,
  getPlayerId: () => 0 as PlayerId,
  getMap: () => map,
  renderer: {
    showMovementEvents: vi.fn(),
    animateMovements: vi.fn((_movements, _ordnanceMovements, onComplete) =>
      onComplete(),
    ),
    showCombatResults: vi.fn(),
    triggerGameOverEffect: vi.fn(() => 0),
    showLandingEffect: vi.fn(),
  },
  ui: {
    log: {
      logMovementEvents: vi.fn(),
      logCombatResults: vi.fn(),
      logText: vi.fn(),
      logLanding: vi.fn(),
    },
    overlay: {
      showToast: vi.fn(),
      showGameOver: vi.fn(),
    },
  },
});

describe('presentation audio cues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses a subtle trajectory cue for drift and a landing cue for touchdown', () => {
    const landingHex = { q: 1, r: 0 };
    const state = createState({
      players: [
        {
          connected: true,
          ready: true,
          targetBody: 'Mars',
          homeBody: 'Terra',
          bases: [hexKey(landingHex)],
          escapeWins: false,
        },
        createState().players[1],
      ],
    });
    const deps = createDeps(state);

    presentMovementResult(
      deps,
      state,
      [
        createMovement({
          to: landingHex,
          outcome: 'landing',
          landedAt: 'Mars',
        } as Partial<ShipMovement>),
      ],
      [],
      [],
      vi.fn(),
    );

    expect(playTrajectory).toHaveBeenCalledTimes(1);
    expect(playThrust).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(playLanding).toHaveBeenCalledWith(true);
  });

  it('uses powered movement and ordnance-impact cues when hazards resolve', () => {
    const state = createState();
    const deps = createDeps(state);

    presentMovementResult(
      deps,
      state,
      [createMovement({ fuelSpent: 1 })],
      [],
      [createMovementEvent({ type: 'torpedoHit', damageType: 'disabled' })],
      vi.fn(),
    );

    expect(playThrust).toHaveBeenCalledTimes(1);
    expect(playTrajectory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(180);
    expect(playOrdnanceImpact).toHaveBeenCalledWith('torpedoHit', 'disabled');
  });

  it('layers damage and explosion cues over combat resolution', () => {
    const previousState = createState({ phase: 'combat' });
    const state = createState({ phase: 'combat' });
    const deps = createDeps(state);

    presentCombatResults(deps, previousState, state, [
      createCombatResult({
        damageType: 'disabled',
        disabledTurns: 2,
        counterattack: createCombatResult({ damageType: 'eliminated' }),
      }),
    ]);

    expect(playCombat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(220);
    expect(playDamage).toHaveBeenCalledWith('disabled');

    vi.advanceTimersByTime(80);
    expect(playExplosion).toHaveBeenCalledTimes(1);
  });
});

describe('showGameOverOutcome reveal delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows the overlay when the client is still on the game-over screen', () => {
    const state = createState({});
    const deps = createDeps(state);
    deps.renderer.triggerGameOverEffect = vi.fn(() => 1200);

    showGameOverOutcome(deps, true, 'Fleet eliminated!');
    vi.advanceTimersByTime(1200);

    expect(deps.ui.overlay.showGameOver).toHaveBeenCalledTimes(1);
  });

  it('marks the guided match as complete in the game-over stats', () => {
    const state = createState({ scenario: 'biplanetary' });
    const deps = createDeps(state);

    showGameOverOutcome(deps, true, 'Landed first', undefined, {
      trainingComplete: true,
    });
    vi.runAllTimers();

    expect(deps.ui.overlay.showGameOver).toHaveBeenCalledWith(
      true,
      'Landed first',
      expect.objectContaining({ trainingComplete: true }),
    );
  });

  it('suppresses the overlay when the player exited before the delay fired', () => {
    const state = createState({});
    const deps = createDeps(state);
    deps.renderer.triggerGameOverEffect = vi.fn(() => 1200);
    deps.getClientState = () => 'menu' as const;

    showGameOverOutcome(deps, true, 'Fleet eliminated!');
    vi.advanceTimersByTime(1200);

    expect(deps.ui.overlay.showGameOver).not.toHaveBeenCalled();
  });
});
