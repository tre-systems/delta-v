import { applyDamage, lookupOtherDamage, rollD6 } from '../combat';
import {
  BASE_DETECTION_RANGE,
  SHIP_DETECTION_RANGE,
  SHIP_STATS,
} from '../constants';
import {
  type HexCoord,
  hexDistance,
  hexEqual,
  hexKey,
  hexVecLength,
  parseHexKey,
} from '../hex';
import type { GameState, MovementEvent, Ship, SolarSystemMap } from '../types';
import { count } from '../util';
import {
  getEscapeEdge,
  hasEscaped,
  hasEscapedNorth,
  playerControlsBase,
  usesEscapeInspectionRules,
} from './util';

/**
 * Advance to the next player's turn after
 * combat/resupply. Handles damage recovery and
 * turn counter.
 */
export const advanceTurn = (state: GameState): void => {
  for (const ship of state.ships) {
    if (ship.owner !== state.activePlayer) continue;
    if (ship.lifecycle === 'destroyed') continue;

    ship.resuppliedThisTurn = false;

    if (ship.damage.disabledTurns > 0) {
      ship.damage.disabledTurns--;
    }
  }

  state.activePlayer = 1 - state.activePlayer;

  if (state.activePlayer === 0) {
    state.turnNumber++;
  }

  // Spawn reinforcements scheduled for this turn
  applyReinforcements(state);

  // Apply fleet conversion if triggered
  applyFleetConversion(state);

  state.phase = 'astrogation';
};

const getNextShipId = (state: GameState): string => {
  const maxId = state.ships.reduce((max, ship) => {
    const num = parseInt(ship.id.replace(/\D/g, ''), 10);
    return Number.isNaN(num) ? max : Math.max(max, num);
  }, 0);

  return `ship-${maxId + 1}`;
};

const applyReinforcements = (state: GameState): void => {
  const reinforcements = state.scenarioRules.reinforcements;
  if (!reinforcements) return;

  for (const r of reinforcements) {
    if (r.turn !== state.turnNumber) continue;
    if (r.playerId !== state.activePlayer) continue;

    for (const shipDef of r.ships) {
      const stats = SHIP_STATS[shipDef.type];
      if (!stats) continue;

      const id = getNextShipId(state);

      state.ships.push({
        id,
        type: shipDef.type,
        owner: r.playerId,
        originalOwner: r.playerId,
        position: { ...shipDef.position },
        velocity: { ...shipDef.velocity },
        fuel: stats.fuel,
        cargoUsed: 0,
        nukesLaunchedSinceResupply: 0,
        resuppliedThisTurn: false,
        lifecycle: shipDef.startLanded !== false ? 'landed' : 'active',
        control: 'own',
        heroismAvailable: false,
        overloadUsed: false,
        detected: true,
        damage: { disabledTurns: 0 },
      });
    }
  }
};

const applyFleetConversion = (state: GameState): void => {
  const conversion = state.scenarioRules.fleetConversion;
  if (!conversion || conversion.turn !== state.turnNumber) {
    return;
  }

  for (const ship of state.ships) {
    if (ship.owner !== conversion.fromPlayer) continue;
    if (ship.lifecycle === 'destroyed') continue;

    if (conversion.shipTypes && !conversion.shipTypes.includes(ship.type)) {
      continue;
    }

    ship.owner = conversion.toPlayer;
  }
};

/**
 * Update checkpoint body visits for race scenarios.
 * Checks each hex in the path for gravity or surface
 * belonging to a checkpoint body.
 */
export const applyCheckpoints = (
  state: GameState,
  playerId: number,
  path: HexCoord[],
  map: SolarSystemMap,
): void => {
  const checkpoints = state.scenarioRules.checkpointBodies;
  const visited = state.players[playerId].visitedBodies;
  if (!checkpoints || !visited) return;

  for (const hex of path) {
    const mapHex = map.hexes.get(hexKey(hex));
    if (!mapHex) continue;

    const bodyName = mapHex.gravity?.bodyName ?? mapHex.body?.name;

    if (
      bodyName &&
      checkpoints.includes(bodyName) &&
      !visited.includes(bodyName)
    ) {
      visited.push(bodyName);
    }
  }
};

const fugitiveHasEscaped = (
  state: GameState,
  ship: Ship,
  map: SolarSystemMap,
): boolean => {
  const escapeEdge = getEscapeEdge(state);

  if (escapeEdge === 'north') {
    return hasEscapedNorth(ship.position, map.bounds);
  }

  return hasEscaped(ship.position, map.bounds);
};

const hasReturnedCapturedFugitivesToBase = (
  state: GameState,
  map: SolarSystemMap,
): boolean => {
  const fugitive = getFugitiveShip(state);

  if (
    !fugitive ||
    fugitive.lifecycle !== 'landed' ||
    fugitive.owner === fugitive.originalOwner
  ) {
    return false;
  }

  const baseKey = hexKey(fugitive.position);
  const baseHex = map.hexes.get(baseKey);

  return (
    !!baseHex?.base &&
    !state.destroyedBases.includes(baseKey) &&
    playerControlsBase(state, fugitive.owner, baseKey)
  );
};

/**
 * Check immediate movement-based victory conditions.
 */
export const checkImmediateVictory = (
  state: GameState,
  map?: SolarSystemMap,
): void => {
  if (!map) return;

  // Checkpoint race victory: all bodies visited + landed
  if (state.scenarioRules.checkpointBodies) {
    for (const ship of state.ships) {
      if (ship.lifecycle !== 'landed') continue;

      const player = state.players[ship.owner];
      if (!player.visitedBodies) continue;

      const allVisited = state.scenarioRules.checkpointBodies.every((b) =>
        player.visitedBodies?.includes(b),
      );

      if (!allVisited) continue;

      const hex = map.hexes.get(hexKey(ship.position));

      if (
        hex?.base?.bodyName === player.homeBody ||
        hex?.body?.name === player.homeBody
      ) {
        state.winner = ship.owner;
        state.winReason = `Grand Tour complete! Visited all ${state.scenarioRules.checkpointBodies.length} bodies.`;
        state.phase = 'gameOver';
        return;
      }
    }
  }

  for (const ship of state.ships) {
    if (ship.lifecycle !== 'landed') continue;

    const targetBody = state.players[ship.owner].targetBody;
    if (!targetBody) continue;

    const hex = map.hexes.get(hexKey(ship.position));

    if (hex?.base?.bodyName === targetBody || hex?.body?.name === targetBody) {
      state.winner = ship.owner;
      state.winReason = `Landed on ${targetBody}!`;
      state.phase = 'gameOver';
      return;
    }
  }

  for (const ship of state.ships) {
    if (ship.lifecycle === 'destroyed') continue;
    if (!state.players[ship.owner].escapeWins) continue;
    if (!fugitiveHasEscaped(state, ship, map)) continue;

    const hasFugitiveScenario = state.ships.some(
      (s) => s.owner === ship.owner && s.identity?.hasFugitives,
    );

    if (hasFugitiveScenario && !ship.identity?.hasFugitives) {
      continue;
    }

    state.winner = ship.owner;

    if (ship.identity?.hasFugitives) {
      const fuelNeededToStop = hexVecLength(ship.velocity) + 1;

      state.winReason =
        ship.fuel >= fuelNeededToStop
          ? 'Pilgrims decisive victory — the fugitives escaped beyond Jupiter with fuel to spare!'
          : 'Pilgrims marginal victory — the fugitives escaped beyond Jupiter!';
    } else {
      state.winReason = 'Escaped the solar system!';
    }

    state.phase = 'gameOver';
    return;
  }
};

export const getFugitiveShip = (state: GameState): Ship | undefined =>
  state.ships.find((ship) => ship.identity?.hasFugitives);

/**
 * Check if the game has ended (victory or all ships
 * destroyed).
 */
export const checkGameEnd = (state: GameState, map?: SolarSystemMap): void => {
  checkImmediateVictory(state, map);

  if (state.winner !== null) {
    return;
  }

  if (usesEscapeInspectionRules(state)) {
    const fugitive = getFugitiveShip(state);

    if (fugitive?.lifecycle === 'destroyed') {
      if (state.escapeMoralVictoryAchieved) {
        state.winner = fugitive.owner;
        state.winReason =
          'Pilgrims moral victory — the fugitives were lost, but they disabled an Enforcer ship.';
      } else {
        const opponent = 1 - fugitive.owner;
        state.winner = opponent;
        state.winReason =
          'Enforcers marginal victory — the fugitive transport was destroyed.';
      }
      state.phase = 'gameOver';
      return;
    }

    if (map && hasReturnedCapturedFugitivesToBase(state, map)) {
      const fugitiveOriginalOwner = fugitive?.originalOwner ?? 1;

      if (state.escapeMoralVictoryAchieved) {
        state.winner = fugitiveOriginalOwner;
        state.winReason =
          'Pilgrims moral victory — the fugitives were captured, but they disabled an Enforcer ship.';
      } else {
        state.winner = 1 - fugitiveOriginalOwner;
        state.winReason =
          'Enforcers decisive victory — the fugitives were captured and returned to base.';
      }
      state.phase = 'gameOver';
      return;
    }

    return;
  }

  const alive0 = count(
    state.ships,
    (s) => s.owner === 0 && s.lifecycle !== 'destroyed',
  );
  const alive1 = count(
    state.ships,
    (s) => s.owner === 1 && s.lifecycle !== 'destroyed',
  );

  if (alive0 === 0 && alive1 === 0) {
    state.winner = 1 - state.activePlayer;
    state.winReason = 'Mutual destruction — last attacker loses!';
    state.phase = 'gameOver';
    return;
  }

  if (alive0 === 0) {
    state.winner = 1;
    state.winReason = 'Fleet eliminated!';
    state.phase = 'gameOver';
    return;
  }

  if (alive1 === 0) {
    state.winner = 0;
    state.winReason = 'Fleet eliminated!';
    state.phase = 'gameOver';
    return;
  }
};

export const applyEscapeMoralVictory = (state: GameState): void => {
  if (state.escapeMoralVictoryAchieved || !usesEscapeInspectionRules(state)) {
    return;
  }

  const fugitiveOwner =
    getFugitiveShip(state)?.originalOwner ??
    state.players.findIndex((player) => player.escapeWins);

  if (fugitiveOwner < 0) {
    return;
  }

  const enforcerOwner = 1 - fugitiveOwner;

  if (
    state.ships.some(
      (ship) =>
        ship.owner === enforcerOwner &&
        (ship.lifecycle === 'destroyed' || ship.damage.disabledTurns > 0),
    )
  ) {
    state.escapeMoralVictoryAchieved = true;
  }
};

/**
 * Check for ramming: opposing ships on the same hex
 * after movement.
 */
export const checkRamming = (
  state: GameState,
  events: MovementEvent[],
  rng: () => number,
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

        applyDamage(ship, result);
      }
    }
  }
};

/**
 * Reveal hidden-identity ships when an enemy matches
 * courses with them.
 */
export const checkInspection = (state: GameState, playerId: number): void => {
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
      if (!target.identity || target.identity.revealed) continue;
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
    }
  }
};

/**
 * Check for capture: moving player's ship on same
 * hex/velocity as disabled enemy.
 */
export const checkCapture = (
  state: GameState,
  playerId: number,
  events: MovementEvent[],
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
      if (target.identity) target.identity.revealed = true;

      events.push({
        type: 'capture',
        shipId: target.id,
        hex: target.position,
        dieRoll: 0,
        damageType: 'captured',
        disabledTurns: 0,
        capturedBy: captor.id,
      });
    }
  }
};

/**
 * Check if any moving player's ships can resupply
 * from friendly emplaced orbital bases.
 */
export const checkOrbitalBaseResupply = (
  state: GameState,
  playerId: number,
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
        ship.cargoUsed = 0;
        ship.nukesLaunchedSinceResupply = 0;
        ship.damage = { disabledTurns: 0 };
        ship.control = 'own';
        ship.resuppliedThisTurn = true;
        ob.resuppliedThisTurn = true;
      }

      break;
    }
  }
};

/**
 * Resupply a ship that has landed at a base.
 */
export const applyResupply = (
  ship: Ship,
  state: GameState,
  map: SolarSystemMap,
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
    ship.cargoUsed = 0;
    ship.nukesLaunchedSinceResupply = 0;
    ship.overloadUsed = false;
    ship.damage = { disabledTurns: 0 };
    ship.control = 'own';
    ship.resuppliedThisTurn = true;
  }
};

/**
 * Update detection status for all ships.
 */
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
