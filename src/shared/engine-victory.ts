import { applyDamage, lookupOtherDamage, rollD6 } from './combat';
import { BASE_DETECTION_RANGE, SHIP_DETECTION_RANGE, SHIP_STATS } from './constants';
import {
  getEscapeEdge,
  hasEscaped,
  hasEscapedNorth,
  playerControlsBase,
  usesEscapeInspectionRules,
} from './engine-util';
import { type HexCoord, hexDistance, hexEqual, hexKey, hexVecLength } from './hex';
import type { GameState, MovementEvent, Ship, SolarSystemMap } from './types';

/**
 * Advance to the next player's turn after combat/resupply.
 * Handles damage recovery and turn counter.
 */
export function advanceTurn(state: GameState): void {
  for (const ship of state.ships) {
    if (ship.owner !== state.activePlayer) continue;
    if (ship.destroyed) continue;
    ship.resuppliedThisTurn = false;
    if (ship.damage.disabledTurns > 0) {
      ship.damage.disabledTurns--;
    }
  }

  state.activePlayer = 1 - state.activePlayer;
  if (state.activePlayer === 0) {
    state.turnNumber++;
  }
  state.phase = 'astrogation';
}

/**
 * Update checkpoint body visits for race scenarios.
 * Checks each hex in the path for gravity or surface belonging to a checkpoint body.
 */
export function updateCheckpoints(state: GameState, playerId: number, path: HexCoord[], map: SolarSystemMap): void {
  const checkpoints = state.scenarioRules.checkpointBodies;
  const visited = state.players[playerId].visitedBodies;
  if (!checkpoints || !visited) return;

  for (const hex of path) {
    const mapHex = map.hexes.get(hexKey(hex));
    if (!mapHex) continue;
    const bodyName = mapHex.gravity?.bodyName ?? mapHex.body?.name;
    if (bodyName && checkpoints.includes(bodyName) && !visited.includes(bodyName)) {
      visited.push(bodyName);
    }
  }
}

/**
 * Check immediate movement-based victory conditions.
 */
export function checkImmediateVictory(state: GameState, map?: SolarSystemMap): void {
  if (!map) return;

  // Checkpoint race victory: all bodies visited + landed at home
  if (state.scenarioRules.checkpointBodies) {
    for (const ship of state.ships) {
      if (ship.destroyed || !ship.landed) continue;
      const player = state.players[ship.owner];
      if (!player.visitedBodies) continue;
      const allVisited = state.scenarioRules.checkpointBodies.every((b) => player.visitedBodies!.includes(b));
      if (!allVisited) continue;
      const hex = map.hexes.get(hexKey(ship.position));
      if (hex?.base?.bodyName === player.homeBody || hex?.body?.name === player.homeBody) {
        state.winner = ship.owner;
        state.winReason = `Grand Tour complete! Visited all ${state.scenarioRules.checkpointBodies.length} bodies.`;
        state.phase = 'gameOver';
        return;
      }
    }
  }

  for (const ship of state.ships) {
    if (ship.destroyed || !ship.landed) continue;
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
    if (ship.destroyed) continue;
    if (!state.players[ship.owner].escapeWins) continue;
    if (!fugitiveHasEscaped(state, ship, map)) continue;

    const hasFugitiveScenario = state.ships.some((s) => s.owner === ship.owner && s.hasFugitives);
    if (hasFugitiveScenario && !ship.hasFugitives) continue;

    state.winner = ship.owner;
    if (ship.hasFugitives) {
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
}

/**
 * Check if the game has ended (victory or all ships destroyed).
 */
export function checkGameEnd(state: GameState, map?: SolarSystemMap): void {
  checkImmediateVictory(state, map);
  if (state.winner !== null) {
    return;
  }

  if (usesEscapeInspectionRules(state)) {
    const fugitive = getFugitiveShip(state);
    if (fugitive?.destroyed) {
      if (state.escapeMoralVictoryAchieved) {
        state.winner = fugitive.owner;
        state.winReason = 'Pilgrims moral victory — the fugitives were lost, but they disabled an Enforcer ship.';
      } else {
        const opponent = 1 - fugitive.owner;
        state.winner = opponent;
        state.winReason = 'Enforcers marginal victory — the fugitive transport was destroyed.';
      }
      state.phase = 'gameOver';
      return;
    }
    if (map && hasReturnedCapturedFugitivesToBase(state, map)) {
      const fugitiveOwner = fugitive?.owner ?? 1;
      if (state.escapeMoralVictoryAchieved) {
        state.winner = 1 - fugitiveOwner;
        state.winReason = 'Pilgrims moral victory — the fugitives were captured, but they disabled an Enforcer ship.';
      } else {
        state.winner = fugitiveOwner;
        state.winReason = 'Enforcers decisive victory — the fugitives were captured and returned to base.';
      }
      state.phase = 'gameOver';
      return;
    }
    return;
  }

  const alive0 = state.ships.filter((s) => s.owner === 0 && !s.destroyed).length;
  const alive1 = state.ships.filter((s) => s.owner === 1 && !s.destroyed).length;
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
}

export function getFugitiveShip(state: GameState): Ship | undefined {
  return state.ships.find((ship) => ship.hasFugitives);
}

export function updateEscapeMoralVictory(state: GameState): void {
  if (state.escapeMoralVictoryAchieved || !usesEscapeInspectionRules(state)) {
    return;
  }

  const fugitiveOwner = getFugitiveShip(state)?.owner ?? state.players.findIndex((player) => player.escapeWins);
  if (fugitiveOwner < 0) {
    return;
  }

  const enforcerOwner = 1 - fugitiveOwner;
  if (state.ships.some((ship) => ship.owner === enforcerOwner && (ship.destroyed || ship.damage.disabledTurns > 0))) {
    state.escapeMoralVictoryAchieved = true;
  }
}

function fugitiveHasEscaped(state: GameState, ship: Ship, map: SolarSystemMap): boolean {
  const escapeEdge = getEscapeEdge(state);
  if (escapeEdge === 'north') {
    return hasEscapedNorth(ship.position, map.bounds);
  }
  return hasEscaped(ship.position, map.bounds);
}

function hasReturnedCapturedFugitivesToBase(state: GameState, map: SolarSystemMap): boolean {
  const fugitive = getFugitiveShip(state);
  if (!fugitive || fugitive.destroyed || !fugitive.captured || !fugitive.landed) {
    return false;
  }
  const baseKey = hexKey(fugitive.position);
  const baseHex = map.hexes.get(baseKey);
  return (
    !!baseHex?.base && !state.destroyedBases.includes(baseKey) && playerControlsBase(state, fugitive.owner, baseKey)
  );
}

/**
 * Check for ramming: opposing ships on the same hex after movement.
 */
export function checkRamming(state: GameState, events: MovementEvent[], rng?: () => number): void {
  const alive = state.ships.filter((s) => !s.destroyed);

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      if (a.owner === b.owner) continue;
      if (!hexEqual(a.position, b.position)) continue;
      if (a.landed || b.landed) continue;
      if (a.captured || b.captured) continue;

      for (const ship of [a, b]) {
        if (ship.destroyed) continue;
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
}

/**
 * Reveal hidden-identity ships when an enemy matches courses with them.
 */
export function checkInspection(state: GameState, playerId: number): void {
  if (!usesEscapeInspectionRules(state)) return;

  const inspectingShips = state.ships.filter(
    (ship) => ship.owner === playerId && !ship.destroyed && !ship.landed && ship.damage.disabledTurns === 0,
  );

  for (const inspector of inspectingShips) {
    for (const target of state.ships) {
      if (target.owner === playerId || target.destroyed) continue;
      if (target.identityRevealed) continue;
      if (!hexEqual(inspector.position, target.position)) continue;
      if (inspector.velocity.dq !== target.velocity.dq || inspector.velocity.dr !== target.velocity.dr) continue;
      target.identityRevealed = true;
    }
  }
}

/**
 * Check for capture: moving player's ship on same hex/velocity as disabled enemy.
 */
export function checkCapture(state: GameState, playerId: number, events: MovementEvent[]): void {
  const playerShips = state.ships.filter(
    (s) => s.owner === playerId && !s.destroyed && !s.landed && s.damage.disabledTurns === 0,
  );

  for (const captor of playerShips) {
    for (const target of state.ships) {
      if (target.owner === playerId || target.destroyed) continue;
      if (target.damage.disabledTurns <= 0) continue;
      if (target.captured) continue;
      if (!hexEqual(captor.position, target.position)) continue;
      if (captor.velocity.dq !== target.velocity.dq || captor.velocity.dr !== target.velocity.dr) continue;

      target.captured = true;
      target.owner = playerId;
      target.identityRevealed = true;

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
}

/**
 * Check if any moving player's ships can resupply from friendly emplaced orbital bases.
 */
export function checkOrbitalBaseResupply(state: GameState, playerId: number): void {
  const orbitalBases = state.ships.filter(
    (s) => s.owner === playerId && !s.destroyed && s.emplaced && s.type === 'orbitalBase',
  );

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.destroyed || ship.emplaced) continue;
    if (ship.resuppliedThisTurn) continue;

    for (const ob of orbitalBases) {
      if (!hexEqual(ship.position, ob.position)) continue;
      if (ship.velocity.dq !== ob.velocity.dq || ship.velocity.dr !== ob.velocity.dr) continue;

      const stats = SHIP_STATS[ship.type];
      if (stats) {
        ship.fuel = stats.fuel;
        ship.cargoUsed = 0;
        ship.nukesLaunchedSinceResupply = 0;
        ship.damage = { disabledTurns: 0 };
        ship.captured = false;
        ship.resuppliedThisTurn = true;
        ob.resuppliedThisTurn = true;
      }
      break;
    }
  }
}

/**
 * Resupply a ship that has landed at a base.
 */
export function applyResupply(ship: Ship, state: GameState, map: SolarSystemMap): void {
  const baseKey = hexKey(ship.position);
  const hex = map.hexes.get(baseKey);
  if (!hex?.base || state.destroyedBases.includes(baseKey)) return;
  if (!playerControlsBase(state, ship.owner, baseKey)) return;

  const stats = SHIP_STATS[ship.type];
  if (stats) {
    ship.fuel = stats.fuel;
    ship.cargoUsed = 0;
    ship.nukesLaunchedSinceResupply = 0;
    ship.overloadUsed = false;
    ship.damage = { disabledTurns: 0 };
    ship.captured = false;
    ship.resuppliedThisTurn = true;
  }
}

/**
 * Update detection status for all ships.
 */
export function updateDetection(state: GameState, map: SolarSystemMap): void {
  for (const ship of state.ships) {
    if (ship.destroyed) continue;

    if (ship.landed) {
      const key = hexKey(ship.position);
      const hex = map.hexes.get(key);
      if (hex?.base && !state.destroyedBases.includes(key) && playerControlsBase(state, ship.owner, key)) {
        ship.detected = false;
        continue;
      }
    }

    if (ship.detected) continue;

    for (const other of state.ships) {
      if (other.owner === ship.owner || other.destroyed) continue;
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
      const [q, r] = key.split(',').map(Number);
      if (hexDistance(ship.position, { q, r }) <= BASE_DETECTION_RANGE) {
        ship.detected = true;
        break;
      }
    }
  }
}
