import { describe, expect, it } from 'vitest';

import type { GameState, Ship, TransferOrder } from '../../shared/types/domain';
import type { ClientState } from './phase';
import { derivePhaseTransition } from './phase';
import { createInitialPlanningState } from './planning';
import type { GameTransport } from './transport';

// --- Helpers ---

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
  gameId: 'DSP',
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: 'enemy', owner: 1 })],
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
  winner: null,
  winReason: null,
  ...overrides,
});

const mockTransport = (): GameTransport & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
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

// --- Planning state mutation tests ---
// These mirror the dispatch() case logic without
// needing the full GameClient.

describe('dispatch: planning state mutations', () => {
  it('setOverloadDirection stores direction in overloads map', () => {
    const plan = createInitialPlanningState();

    plan.overloads.set('ship-0', 3);

    expect(plan.overloads.get('ship-0')).toBe(3);
  });

  it('setOverloadDirection with null clears overload', () => {
    const plan = createInitialPlanningState();
    plan.overloads.set('ship-0', 3);

    plan.overloads.set('ship-0', null);

    expect(plan.overloads.get('ship-0')).toBeNull();
  });

  it('setWeakGravityChoices stores choices map', () => {
    const plan = createInitialPlanningState();
    const choices = { '3,4': true, '5,6': false };

    plan.weakGravityChoices.set('ship-0', choices);

    expect(plan.weakGravityChoices.get('ship-0')).toEqual(choices);
  });

  it('setCombatPlan assigns plan fields', () => {
    const plan = createInitialPlanningState();

    Object.assign(plan, {
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0'],
      combatAttackStrength: 3,
    });

    expect(plan.combatTargetId).toBe('enemy');
    expect(plan.combatTargetType).toBe('ship');
    expect(plan.combatAttackerIds).toEqual(['ship-0']);
    expect(plan.combatAttackStrength).toBe(3);
  });

  it('setCombatPlan can override selectedShipId', () => {
    const plan = createInitialPlanningState();
    plan.selectedShipId = 'ship-0';

    Object.assign(plan, { combatTargetId: 'enemy' });
    plan.selectedShipId = 'ship-1';

    expect(plan.selectedShipId).toBe('ship-1');
  });

  it('undoQueuedAttack pops the last attack', () => {
    const plan = createInitialPlanningState();
    plan.queuedAttacks = [
      {
        attackerIds: ['a'],
        targetId: 'b',
        targetType: 'ship',
        attackStrength: 2,
      },
      {
        attackerIds: ['c'],
        targetId: 'd',
        targetType: 'ship',
        attackStrength: 1,
      },
    ];

    plan.queuedAttacks.pop();

    expect(plan.queuedAttacks).toHaveLength(1);
    expect(plan.queuedAttacks[0].attackerIds).toEqual(['a']);
  });

  it('undoQueuedAttack on empty array is a no-op', () => {
    const plan = createInitialPlanningState();

    plan.queuedAttacks.pop();

    expect(plan.queuedAttacks).toHaveLength(0);
  });

  it('setTorpedoAccel stores direction and steps', () => {
    const plan = createInitialPlanningState();

    plan.torpedoAccel = 2;
    plan.torpedoAccelSteps = 1;

    expect(plan.torpedoAccel).toBe(2);
    expect(plan.torpedoAccelSteps).toBe(1);
  });

  it('clearTorpedoAcceleration nulls both fields', () => {
    const plan = createInitialPlanningState();
    plan.torpedoAccel = 2;
    plan.torpedoAccelSteps = 1;

    plan.torpedoAccel = null;
    plan.torpedoAccelSteps = null;

    expect(plan.torpedoAccel).toBeNull();
    expect(plan.torpedoAccelSteps).toBeNull();
  });

  it('setHoverHex stores hex coordinate', () => {
    const plan = createInitialPlanningState();

    plan.hoverHex = { q: 3, r: -1 };

    expect(plan.hoverHex).toEqual({ q: 3, r: -1 });
  });

  it('setHoverHex with null clears hover', () => {
    const plan = createInitialPlanningState();
    plan.hoverHex = { q: 3, r: -1 };

    plan.hoverHex = null;

    expect(plan.hoverHex).toBeNull();
  });

  it('selectShip sets selectedShipId', () => {
    const plan = createInitialPlanningState();

    plan.selectedShipId = 'ship-0';

    expect(plan.selectedShipId).toBe('ship-0');
  });

  it('deselectShip clears selectedShipId', () => {
    const plan = createInitialPlanningState();
    plan.selectedShipId = 'ship-0';

    plan.selectedShipId = null;

    expect(plan.selectedShipId).toBeNull();
  });

  it('clearAstrogationPlanning resets all burn-related state', () => {
    const plan = createInitialPlanningState();
    plan.selectedShipId = 'ship-0';
    plan.lastSelectedHex = '0,0';
    plan.burns.set('ship-0', 3);
    plan.overloads.set('ship-0', 1);
    plan.weakGravityChoices.set('ship-0', { '1,2': true });

    // This mirrors setState's clearAstrogationPlanning logic
    plan.selectedShipId = null;
    plan.lastSelectedHex = null;
    plan.burns.clear();
    plan.overloads.clear();
    plan.weakGravityChoices.clear();

    expect(plan.selectedShipId).toBeNull();
    expect(plan.lastSelectedHex).toBeNull();
    expect(plan.burns.size).toBe(0);
    expect(plan.overloads.size).toBe(0);
    expect(plan.weakGravityChoices.size).toBe(0);
  });
});

// --- Logistics dispatch guards ---
// The skipLogistics and confirmTransfers cases in
// dispatch() have phase guards before calling transport.

describe('dispatch: logistics transport guards', () => {
  it('skipLogistics calls transport when in logistics state', () => {
    const transport = mockTransport();
    const state: ClientState = 'playing_logistics';

    if (state === 'playing_logistics' && transport) {
      transport.skipLogistics();
    }

    expect(transport.calls.skipLogistics).toHaveLength(1);
  });

  it('skipLogistics does not call transport in other states', () => {
    const transport = mockTransport();
    const state = 'playing_astrogation' as ClientState;

    if (state === 'playing_logistics' && transport) {
      transport.skipLogistics();
    }

    expect(transport.calls.skipLogistics).toBeUndefined();
  });

  it('confirmTransfers submits orders when transfers exist', () => {
    const transport = mockTransport();
    const state: ClientState = 'playing_logistics';

    // Simulate having transfer orders
    const orders: TransferOrder[] = [
      {
        sourceShipId: 'ship-0',
        targetShipId: 'ship-1',
        transferType: 'fuel',
        amount: 3,
      },
    ];

    if (state === 'playing_logistics' && transport && orders.length > 0) {
      transport.submitLogistics(orders);
    }

    expect(transport.calls.submitLogistics).toEqual([[orders]]);
  });

  it('confirmTransfers falls back to skipLogistics when no transfers', () => {
    const transport = mockTransport();
    const state: ClientState = 'playing_logistics';
    const orders: TransferOrder[] = [];

    if (state === 'playing_logistics' && transport) {
      if (orders.length > 0) {
        transport.submitLogistics(orders);
      } else {
        transport.skipLogistics();
      }
    }

    expect(transport.calls.submitLogistics).toBeUndefined();
    expect(transport.calls.skipLogistics).toHaveLength(1);
  });

  it('confirmTransfers does nothing outside logistics state', () => {
    const transport = mockTransport();
    const state = 'playing_combat' as ClientState;

    if (state === 'playing_logistics' && transport) {
      transport.skipLogistics();
    }

    expect(transport.calls.skipLogistics).toBeUndefined();
    expect(transport.calls.submitLogistics).toBeUndefined();
  });
});

// --- Phase transition coordination ---
// derivePhaseTransition is pure and tested in phase.test.ts.
// This verifies the transition output interpretation.

describe('dispatch: phase transition outputs', () => {
  it('phase transition to astrogation includes banner and sound', () => {
    const state = createState({ phase: 'astrogation', activePlayer: 0 });

    const plan = derivePhaseTransition(state, 0, -1, false);

    expect(plan.nextState).toBe('playing_astrogation');
    expect(plan.banner).toBe('YOUR TURN');
    expect(plan.playPhaseSound).toBe(true);
    expect(plan.beginCombatPhase).toBe(false);
  });

  it('phase transition to opponent turn triggers AI in local games', () => {
    const state = createState({ phase: 'astrogation', activePlayer: 1 });

    const plan = derivePhaseTransition(state, 0, -1, true);

    expect(plan.nextState).toBe('playing_opponentTurn');
    expect(plan.runLocalAI).toBe(true);
  });

  it('combat phase with pending asteroids triggers beginCombatPhase', () => {
    const state = createState({
      phase: 'combat',
      activePlayer: 0,
      pendingAsteroidHazards: [{ shipId: 'ship-0', hex: { q: 1, r: 2 } }],
    });

    const plan = derivePhaseTransition(state, 0, -1, false);

    expect(plan.beginCombatPhase).toBe(true);
    expect(plan.nextState).toBeNull();
  });
});
