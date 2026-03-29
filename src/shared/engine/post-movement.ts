// Post-movement interactions: ramming, identity inspection, capture,
// resupply, and detection. Extracted from victory.ts (backlog #25).

import { applyDamage, lookupOtherDamage, rollD6 } from '../combat';
import {
  BASE_DETECTION_RANGE,
  SHIP_DETECTION_RANGE,
  SHIP_STATS,
} from '../constants';
import { hexDistance, hexEqual, hexKey, parseHexKey } from '../hex';
import type {
  GameState,
  MovementEvent,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import type { EngineEvent } from './engine-events';
import {
  getCargoUsedAfterResupply,
  playerControlsBase,
  usesEscapeInspectionRules,
} from './util';

// Check for ramming: opposing ships on the same hex after movement.
export const checkRamming = (
  state: GameState,
  events: MovementEvent[],
  rng: () => number,
  engineEvents?: EngineEvent[],
): void => {
  const alive = state.ships.filter((s) => s.lifecycle !== 'destroyed');

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];

      if (a.owner === b.owner) continue;

      if (!hexEqual(a.position, b.position)) continue;

      if (a.lifecycle === 'landed' || b.lifecycle === 'landed') {
        continue;
      }

      if (a.control === 'captured' || b.control === 'captured') {
        continue;
      }

      for (const ship of [a, b]) {
        if (ship.lifecycle === 'destroyed') continue;

        const otherShip = ship === a ? b : a;
        const dieRoll = rollD6(rng);
        const result = lookupOtherDamage(dieRoll, 'ram');

        events.push({
          type: 'ramming',
          shipId: ship.id,
          hex: ship.position,
          dieRoll,
          damageType: result.type,
          disabledTurns: result.disabledTurns,
        });

        engineEvents?.push({
          type: 'ramming',
          shipId: ship.id,
          otherShipId: otherShip.id,
          hex: ship.position,
          roll: dieRoll,
          damageType: result.type,
          disabledTurns: result.disabledTurns,
        });

        applyDamage(ship, result, 'ramming', otherShip.id);

        if ((ship.lifecycle as string) === 'destroyed') {
          engineEvents?.push({
            type: 'shipDestroyed',
            shipId: ship.id,
            cause: 'ramming',
          });
        }
      }
    }
  }
};

// Reveal hidden-identity ships when an enemy matches courses with them.
export const checkInspection = (
  state: GameState,
  playerId: PlayerId,
  engineEvents?: EngineEvent[],
): void => {
  if (!usesEscapeInspectionRules(state)) return;

  const inspectingShips = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle === 'active' &&
      ship.damage.disabledTurns === 0,
  );

  for (const inspector of inspectingShips) {
    for (const target of state.ships) {
      if (target.owner === playerId || target.lifecycle === 'destroyed') {
        continue;
      }

      if (!target.identity || target.identity.revealed) {
        continue;
      }

      if (!hexEqual(inspector.position, target.position)) {
        continue;
      }

      if (
        inspector.velocity.dq !== target.velocity.dq ||
        inspector.velocity.dr !== target.velocity.dr
      ) {
        continue;
      }

      target.identity.revealed = true;
      engineEvents?.push({
        type: 'identityRevealed',
        shipId: target.id,
      });
    }
  }
};

// Check for capture: moving player's ship on same hex/velocity as disabled enemy.
export const checkCapture = (
  state: GameState,
  playerId: PlayerId,
  events: MovementEvent[],
  engineEvents?: EngineEvent[],
): void => {
  const playerShips = state.ships.filter(
    (s) =>
      s.owner === playerId &&
      s.lifecycle === 'active' &&
      s.damage.disabledTurns === 0,
  );

  for (const captor of playerShips) {
    for (const target of state.ships) {
      if (target.owner === playerId || target.lifecycle === 'destroyed') {
        continue;
      }

      if (target.damage.disabledTurns <= 0) continue;

      if (target.control === 'captured') continue;

      if (!hexEqual(captor.position, target.position)) {
        continue;
      }

      if (
        captor.velocity.dq !== target.velocity.dq ||
        captor.velocity.dr !== target.velocity.dr
      ) {
        continue;
      }

      target.control = 'captured';
      target.owner = playerId;

      if (target.identity) {
        target.identity.revealed = true;
      }

      events.push({
        type: 'capture',
        shipId: target.id,
        hex: target.position,
        dieRoll: 0,
        damageType: 'captured',
        disabledTurns: 0,
        capturedBy: captor.id,
      });

      engineEvents?.push({
        type: 'shipCaptured',
        shipId: target.id,
        capturedBy: playerId,
        capturedByShipId: captor.id,
      });
    }
  }
};

// Check if any moving player's ships can resupply from friendly emplaced orbital bases.
export const checkOrbitalBaseResupply = (
  state: GameState,
  playerId: PlayerId,
  engineEvents?: EngineEvent[],
): void => {
  const orbitalBases = state.ships.filter(
    (s) =>
      s.owner === playerId &&
      s.lifecycle !== 'destroyed' &&
      s.baseStatus === 'emplaced' &&
      s.type === 'orbitalBase',
  );

  for (const ship of state.ships) {
    if (
      ship.owner !== playerId ||
      ship.lifecycle === 'destroyed' ||
      ship.baseStatus === 'emplaced'
    ) {
      continue;
    }

    if (ship.resuppliedThisTurn) continue;

    for (const ob of orbitalBases) {
      if (!hexEqual(ship.position, ob.position)) {
        continue;
      }

      if (
        ship.velocity.dq !== ob.velocity.dq ||
        ship.velocity.dr !== ob.velocity.dr
      ) {
        continue;
      }

      const stats = SHIP_STATS[ship.type];

      if (stats) {
        ship.fuel = stats.fuel;
        ship.cargoUsed = getCargoUsedAfterResupply(ship);
        ship.nukesLaunchedSinceResupply = 0;
        ship.damage = { disabledTurns: 0 };
        ship.control = 'own';
        ship.resuppliedThisTurn = true;
        ob.resuppliedThisTurn = true;
        engineEvents?.push({
          type: 'shipResupplied',
          shipId: ship.id,
          source: 'orbitalBase',
          sourceId: ob.id,
        });
      }

      break;
    }
  }
};

// Resupply a ship that has landed at a base.
export const applyResupply = (
  ship: Ship,
  state: GameState,
  map: SolarSystemMap,
  engineEvents?: EngineEvent[],
): void => {
  const baseKey = hexKey(ship.position);
  const hex = map.hexes.get(baseKey);

  if (!hex?.base || state.destroyedBases.includes(baseKey)) {
    return;
  }

  if (!playerControlsBase(state, ship.owner, baseKey)) {
    return;
  }

  const stats = SHIP_STATS[ship.type];

  if (stats) {
    ship.fuel = stats.fuel;
    ship.cargoUsed = getCargoUsedAfterResupply(ship);
    ship.nukesLaunchedSinceResupply = 0;
    ship.overloadUsed = false;
    ship.damage = { disabledTurns: 0 };
    ship.control = 'own';
    ship.resuppliedThisTurn = true;
    engineEvents?.push({
      type: 'shipResupplied',
      shipId: ship.id,
      source: 'base',
    });
  }
};

// Update detection status for all ships.
export const applyDetection = (state: GameState, map: SolarSystemMap): void => {
  for (const ship of state.ships) {
    if (ship.lifecycle === 'destroyed') continue;

    if (ship.lifecycle === 'landed') {
      const key = hexKey(ship.position);
      const hex = map.hexes.get(key);

      if (
        hex?.base &&
        !state.destroyedBases.includes(key) &&
        playerControlsBase(state, ship.owner, key)
      ) {
        ship.detected = false;
        continue;
      }
    }

    if (ship.detected) continue;

    for (const other of state.ships) {
      if (other.owner === ship.owner || other.lifecycle === 'destroyed') {
        continue;
      }

      if (hexDistance(ship.position, other.position) <= SHIP_DETECTION_RANGE) {
        ship.detected = true;
        break;
      }
    }

    if (ship.detected) continue;

    for (const key of state.players[1 - ship.owner].bases) {
      const hex = map.hexes.get(key);

      if (!hex?.base) continue;

      if (state.destroyedBases.includes(key)) continue;

      const baseCoord = parseHexKey(key);

      if (hexDistance(ship.position, baseCoord) <= BASE_DETECTION_RANGE) {
        ship.detected = true;
        break;
      }
    }
  }
};
