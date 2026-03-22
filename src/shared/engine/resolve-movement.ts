import { hexKey } from '../hex';
import { computeCourse } from '../movement';
import type {
  GameState,
  MovementEvent,
  OrdnanceMovement,
  ShipMovement,
  SolarSystemMap,
} from '../types';
import { shouldEnterCombatPhase } from './combat';
import type { MovementResult } from './game-engine';
import { shouldEnterLogisticsPhase } from './logistics';
import { moveOrdnance, queueAsteroidHazards } from './ordnance';
import { usesEscapeInspectionRules } from './util';
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

export const filterStateForPlayer = (
  state: GameState,
  playerId: number,
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
      if (ship.owner === playerId) {
        return ship;
      }
      if (ship.identity?.revealed) {
        return ship;
      }
      const { identity, ...rest } = ship;
      return rest;
    }),
  };
};

/**
 * Central movement orchestrator -- resolves queued
 * orders, then runs all post-movement checks
 * (resupply, ramming, ordnance, detection, victory).
 */
export const resolveMovementPhase = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
): MovementResult => {
  const movements: ShipMovement[] = [];
  const ordnanceMovements: OrdnanceMovement[] = [];
  const events: MovementEvent[] = [];
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
    const course = computeCourse(ship, burn, map, {
      overload,
      weakGravityChoices: order?.weakGravityChoices,
      destroyedBases: state.destroyedBases,
    });
    movements.push({
      shipId: ship.id,
      from: { ...ship.position },
      to: course.destination,
      path: course.path,
      newVelocity: course.newVelocity,
      fuelSpent: course.fuelSpent,
      gravityEffects: course.gravityEffects,
      crashed: course.crashed,
      landedAt: course.landedAt,
    });
    ship.position = course.destination;
    ship.lastMovementPath = course.path.map((hex) => ({ ...hex }));
    ship.velocity = course.newVelocity;
    ship.fuel -= course.fuelSpent;
    if (overload !== null) {
      ship.overloadUsed = true;
    }
    ship.lifecycle = course.landedAt !== null ? 'landed' : 'active';
    ship.pendingGravityEffects = course.landedAt
      ? []
      : course.enteredGravityEffects.map((effect) => ({
          ...effect,
        }));
    if (course.landedAt) {
      ship.velocity = { dq: 0, dr: 0 };
      applyResupply(ship, state, map);
    }
    if (course.crashed) {
      ship.lifecycle = 'destroyed';
      ship.velocity = { dq: 0, dr: 0 };
      ship.pendingGravityEffects = [];
      const crashHex =
        course.path.find(
          (hex, idx) => idx > 0 && map.hexes.get(hexKey(hex))?.body,
        ) ?? course.destination;
      events.push({
        type: 'crash',
        shipId: ship.id,
        hex: crashHex,
        dieRoll: 0,
        damageType: 'eliminated',
        disabledTurns: 0,
      });
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
        applyCheckpoints(state, ship.owner, m.path, map);
        const totalFuelSpent = state.players[ship.owner].totalFuelSpent;
        if (totalFuelSpent !== undefined) {
          state.players[ship.owner].totalFuelSpent =
            totalFuelSpent + m.fuelSpent;
        }
      }
    }
  }
  checkOrbitalBaseResupply(state, playerId);
  checkInspection(state, playerId);
  checkCapture(state, playerId, events);
  checkRamming(state, events, rng);
  moveOrdnance(state, map, ordnanceMovements, events, rng);
  applyDetection(state, map);
  applyEscapeMoralVictory(state);
  checkImmediateVictory(state, map);
  if (state.winner === null) {
    if (shouldEnterLogisticsPhase(state)) {
      state.phase = 'logistics';
    } else if (shouldEnterCombatPhase(state, map)) {
      state.phase = 'combat';
    } else {
      checkGameEnd(state, map);
      if (state.winner === null) {
        advanceTurn(state);
      }
    }
  }
  return {
    movements,
    ordnanceMovements,
    events,
    state,
  };
};
