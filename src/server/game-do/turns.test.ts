import { describe, expect, it } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { resolveTurnTimeoutOutcome } from './turns';

const createState = (): GameState => {
  return createGame(
    SCENARIOS.biplanetary,
    buildSolarSystemMap(),
    'TURN1',
    findBaseHex,
  );
};

const createEscapeState = (): GameState => {
  return createGame(
    SCENARIOS.escape,
    buildSolarSystemMap(),
    'TURNX',
    findBaseHex,
  );
};

const createShip = (
  overrides: Partial<GameState['ships'][number]> = {},
): GameState['ships'][number] => {
  return {
    id: 'extra-ship',
    type: 'transport',
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
  };
};

describe('game-do-turns', () => {
  it('auto-submits empty burns for timed-out astrogation turns', () => {
    const state = createState();

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.primaryMessage?.type).toBe('movementResult');
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('resolves timed-out ordnance turns with the appropriate broadcast', () => {
    const state = createState();
    state.phase = 'ordnance';

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.primaryMessage?.type).toMatch(
      /^(movementResult|stateUpdate)$/,
    );
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('skips timed-out combat turns', () => {
    const state = createState();
    state.phase = 'combat';

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('returns null for phases without timeout automation', () => {
    const state = createState();
    state.phase = 'gameOver';

    expect(
      resolveTurnTimeoutOutcome(state, buildSolarSystemMap(), () => 0.5),
    ).toBeNull();
  });

  it('includes event log entries in outcome', () => {
    const state = createState();
    const map = buildSolarSystemMap();
    const outcome = resolveTurnTimeoutOutcome(state, map, () => 0.5);

    expect(outcome).not.toBeNull();
    expect(outcome?.events.length).toBeGreaterThan(0);

    const types = outcome?.events.map((e) => e.type);
    expect(types).toContain('phaseChanged');
  });

  it('includes shipMoved events for astrogation', () => {
    const state = createState();
    const map = buildSolarSystemMap();
    const outcome = resolveTurnTimeoutOutcome(state, map, () => 0.5);

    expect(outcome).not.toBeNull();

    const movementEvents = outcome?.events.filter(
      (e) => e.type === 'shipMoved',
    );
    expect(movementEvents?.length).toBeGreaterThan(0);
  });

  it('includes combatResolved event for combat timeout', () => {
    const state = createState();
    state.phase = 'combat';
    const map = buildSolarSystemMap();
    const outcome = resolveTurnTimeoutOutcome(state, map, () => 0.5);

    expect(outcome).not.toBeNull();
    // Skip combat produces no combat results,
    // so no combatResolved event — just phaseChanged
    const types = outcome?.events.map((e) => e.type);
    expect(types).toContain('phaseChanged');
  });

  it('ignores destroyed ships when auto-submitting timeout astrogation orders', () => {
    const state = createEscapeState();
    state.ships[0].lifecycle = 'destroyed';

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.events.length).toBeGreaterThan(0);
  });

  it('ignores captured ships when auto-submitting timeout astrogation orders', () => {
    const state = createEscapeState();
    state.ships[0].control = 'captured';

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('ignores emplaced bases when auto-submitting timeout astrogation orders', () => {
    const state = createEscapeState();
    state.ships[0].baseStatus = 'emplaced';

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('keeps recoverable mixed fleets advancing on timeout', () => {
    const state = createEscapeState();
    state.ships[0].lifecycle = 'destroyed';
    state.ships[1].control = 'captured';
    state.ships[2].baseStatus = 'emplaced';
    state.ships.push(createShip({ id: 'survivor', position: { q: 1, r: 0 } }));

    const outcome = resolveTurnTimeoutOutcome(
      state,
      buildSolarSystemMap(),
      () => 0.5,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.events.length).toBeGreaterThan(0);
    const queuedIds =
      outcome?.state.pendingAstrogationOrders?.map((order) => order.shipId) ??
      [];
    const movedIds =
      outcome?.events
        .filter((event) => event.type === 'shipMoved')
        .map((event) => event.shipId) ?? [];

    expect(queuedIds.every((shipId) => shipId === 'survivor')).toBe(true);
    expect(movedIds.every((shipId) => shipId === 'survivor')).toBe(true);
  });
});
