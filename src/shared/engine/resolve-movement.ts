import { computeCourse, detectOrbit } from '../movement';
import type {
  GameState,
  MovementEvent,
  OrdnanceMovement,
  PlayerId,
  ShipMovement,
  SolarSystemMap,
} from '../types';
import { shouldEnterCombatPhase } from './combat';
import type { EngineEvent } from './engine-events';
import type { MovementResult } from './game-engine';
import { shouldEnterLogisticsPhase } from './logistics';
import { moveOrdnance, queueAsteroidHazards } from './ordnance';
import { transitionPhaseWithEvent, usesEscapeInspectionRules } from './util';
import {
  advanceTurn,
  applyCheckpoints,
  applyDetection,
  applyEscapeMoralVictory,
  applyResupply,
  checkCapture,
  checkGameEnd,
  checkImmediateVictory,
  checkInspection,
  checkOrbitalBaseResupply,
  checkRamming,
} from './victory';

// Viewer identity: player seat or spectator/public.
export type ViewerId = number | 'spectator';

export const filterStateForPlayer = (
  state: GameState,
  viewer: ViewerId,
): GameState => {
  if (
    !usesEscapeInspectionRules(state) &&
    !state.ships.some((s) => s.identity?.hasFugitives)
  ) {
    return state;
  }
  return {
    ...state,
    ships: state.ships.map((ship) => {
      // Spectators see no hidden identity
      if (viewer === 'spectator') {
        if (ship.identity?.revealed) return ship;
        const { identity, ...rest } = ship;
        return rest;
      }
      // Players see own ships' identity
      if (ship.owner === viewer) return ship;

      if (ship.identity?.revealed) return ship;
      const { identity, ...rest } = ship;
      return rest;
    }),
  };
};

// Central movement orchestrator -- resolves queued
// orders, then runs all post-movement checks
// (resupply, ramming, ordnance, detection, victory).
export const resolveMovementPhase = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  rng: () => number,
): MovementResult => {
  const movements: ShipMovement[] = [];
  const ordnanceMovements: OrdnanceMovement[] = [];
  const events: MovementEvent[] = [];
  const engineEvents: EngineEvent[] = [];

  const queuedOrders = new Map(
    (state.pendingAstrogationOrders ?? []).map(
      (order) => [order.shipId, order] as const,
    ),
  );
  state.pendingAstrogationOrders = null;

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;

    if (ship.lifecycle === 'destroyed') continue;

    if (ship.baseStatus === 'emplaced') continue;

    const isDisabled = ship.damage.disabledTurns > 0;
    const order = queuedOrders.get(ship.id);
    const burn = isDisabled ? null : (order?.burn ?? null);
    const overload = isDisabled ? null : (order?.overload ?? null);

    const from = { ...ship.position };

    // Auto-land when orbiting the target body — no need for a
    // manual toggle in race scenarios.
    const targetBody = state.players[ship.owner]?.targetBody;
    const shouldAutoLand =
      !order?.land && targetBody && detectOrbit(ship, map) === targetBody;

    const course = computeCourse(ship, burn, map, {
      overload,
      weakGravityChoices: order?.weakGravityChoices,
      destroyedBases: state.destroyedBases,
      land: order?.land || shouldAutoLand || undefined,
    });

    const movementBase = {
      shipId: ship.id,
      from,
      to: course.destination,
      path: course.path,
      newVelocity: course.newVelocity,
      fuelSpent: course.fuelSpent,
      gravityEffects: course.gravityEffects,
    };

    if (course.outcome === 'crash') {
      movements.push({ ...movementBase, outcome: 'crash' });
    } else if (course.outcome === 'landing') {
      movements.push({
        ...movementBase,
        outcome: 'landing',
        landedAt: course.landedAt,
      });
    } else {
      movements.push({ ...movementBase, outcome: 'normal' });
    }

    ship.position = course.destination;
    ship.lastMovementPath = course.path.map((hex) => ({ ...hex }));
    ship.velocity = course.newVelocity;
    ship.fuel -= course.fuelSpent;

    if (burn !== null) {
      ship.lastBurnDirection = burn;
    }

    if (overload !== null) {
      ship.overloadUsed = true;
    }

    ship.lifecycle = course.outcome === 'landing' ? 'landed' : 'active';
    ship.pendingGravityEffects =
      course.outcome === 'landing'
        ? []
        : course.enteredGravityEffects.map((effect) => ({ ...effect }));

    engineEvents.push({
      type: 'shipMoved',
      shipId: ship.id,
      from,
      to: course.destination,
      path: course.path.map((hex) => ({ ...hex })),
      fuelSpent: course.fuelSpent,
      fuelRemaining: ship.fuel,
      newVelocity: course.newVelocity,
      lifecycle: ship.lifecycle,
      overloadUsed: ship.overloadUsed,
      ...(ship.lastBurnDirection !== undefined
        ? { lastBurnDirection: ship.lastBurnDirection }
        : {}),
      pendingGravityEffects: (ship.pendingGravityEffects ?? []).map(
        (effect) => ({
          ...effect,
          hex: { ...effect.hex },
        }),
      ),
    });

    if (course.outcome === 'landing') {
      ship.velocity = { dq: 0, dr: 0 };
      engineEvents.push({
        type: 'shipLanded',
        shipId: ship.id,
        landedAt: course.landedAt,
      });
      applyResupply(ship, state, map, engineEvents);
    }

    if (course.outcome === 'crash') {
      ship.lifecycle = 'destroyed';
      ship.deathCause = 'crash';
      ship.velocity = { dq: 0, dr: 0 };
      ship.pendingGravityEffects = [];

      events.push({
        type: 'crash',
        shipId: ship.id,
        hex: course.crashHex,
        dieRoll: 0,
        damageType: 'eliminated',
        disabledTurns: 0,
      });

      engineEvents.push({
        type: 'shipCrashed',
        shipId: ship.id,
        hex: course.crashHex,
      });
      engineEvents.push({
        type: 'shipDestroyed',
        shipId: ship.id,
        cause: 'crash',
      });
    }

    // Destroy ships that drift far beyond the map boundary
    if (ship.lifecycle !== 'destroyed') {
      const oobMargin = 2;
      const { minQ, maxQ, minR, maxR } = map.bounds;
      const p = ship.position;
      if (
        p.q < minQ - oobMargin ||
        p.q > maxQ + oobMargin ||
        p.r < minR - oobMargin ||
        p.r > maxR + oobMargin
      ) {
        ship.lifecycle = 'destroyed';
        ship.deathCause = 'crash';
        ship.velocity = { dq: 0, dr: 0 };
        ship.pendingGravityEffects = [];
        engineEvents.push({
          type: 'shipDestroyed',
          shipId: ship.id,
          cause: 'crash',
        });
      }
    }

    if (ship.lifecycle !== 'destroyed') {
      queueAsteroidHazards(ship, course.path, course.newVelocity, state, map);
    }
  }

  // Track checkpoint visits and fuel for race
  // scenarios
  if (state.scenarioRules.checkpointBodies) {
    for (const m of movements) {
      const ship = state.ships.find((s) => s.id === m.shipId);

      if (ship && ship.lifecycle !== 'destroyed') {
        applyCheckpoints(state, ship.owner, m.path, map, engineEvents);
        const totalFuelSpent = state.players[ship.owner].totalFuelSpent;

        if (totalFuelSpent !== undefined) {
          state.players[ship.owner].totalFuelSpent =
            totalFuelSpent + m.fuelSpent;
        }
      }
    }
  }

  checkOrbitalBaseResupply(state, playerId, engineEvents);
  checkInspection(state, playerId, engineEvents);
  checkCapture(state, playerId, events, engineEvents);
  checkRamming(state, events, rng, engineEvents);
  moveOrdnance(
    state,
    playerId,
    map,
    movements,
    ordnanceMovements,
    events,
    rng,
    engineEvents,
  );
  applyDetection(state, map);
  applyEscapeMoralVictory(state);
  checkImmediateVictory(state, map, engineEvents);

  if (state.outcome === null) {
    if (shouldEnterCombatPhase(state, map)) {
      transitionPhaseWithEvent(state, 'combat', engineEvents);
    } else if (shouldEnterLogisticsPhase(state)) {
      transitionPhaseWithEvent(state, 'logistics', engineEvents);
    } else {
      checkGameEnd(state, map, engineEvents);

      if (state.outcome === null) {
        advanceTurn(state, engineEvents);
      }
    }
  }

  return {
    movements,
    ordnanceMovements,
    events,
    engineEvents,
    state,
  };
};
