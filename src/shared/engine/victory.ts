// Win predicates and game-end checks.
// Post-movement interactions live in post-movement.ts;
// turn advancement lives in turn-advance.ts (backlog #25).

import { type HexCoord, hexKey, hexVecLength } from '../hex';
import type { GameState, PlayerId, Ship, SolarSystemMap } from '../types';
import { count } from '../util';
import type { EngineEvent } from './engine-events';
import {
  getEscapeEdge,
  hasEscaped,
  hasEscapedNorth,
  playerControlsBase,
  setGameOutcome,
  usesEscapeInspectionRules,
} from './util';

export {
  applyDetection,
  applyResupply,
  checkCapture,
  checkInspection,
  checkOrbitalBaseResupply,
  checkRamming,
} from './post-movement';
// Re-export split modules so existing consumers keep working.
export { advanceTurn } from './turn-advance';

// Update checkpoint body visits for race scenarios.
export const applyCheckpoints = (
  state: GameState,
  playerId: PlayerId,
  path: HexCoord[],
  map: SolarSystemMap,
  engineEvents?: EngineEvent[],
): void => {
  const checkpoints = state.scenarioRules.checkpointBodies;
  const visited = state.players[playerId].visitedBodies;

  if (!checkpoints || !visited) return;

  for (const hex of path) {
    const mapHex = map.hexes.get(hexKey(hex));

    if (!mapHex) continue;

    const bodyName = mapHex.gravity?.bodyName ?? mapHex.body?.name;

    if (bodyName === state.players[playerId].homeBody && visited.length === 0) {
      continue;
    }

    if (
      bodyName &&
      checkpoints.includes(bodyName) &&
      !visited.includes(bodyName)
    ) {
      visited.push(bodyName);
      engineEvents?.push({
        type: 'checkpointVisited',
        playerId,
        body: bodyName,
      });
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

// Check immediate movement-based victory conditions.
export const checkImmediateVictory = (
  state: GameState,
  map?: SolarSystemMap,
  engineEvents?: EngineEvent[],
): void => {
  if (!map) return;

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
        setGameOutcome(
          state,
          ship.owner,
          `Grand Tour complete! Visited all ${state.scenarioRules.checkpointBodies.length} bodies.`,
          engineEvents,
        );
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
      if (state.scenarioRules.targetWinRequiresPassengers) {
        const pax = ship.passengersAboard ?? 0;
        if (pax <= 0) {
          continue;
        }
      }
      setGameOutcome(
        state,
        ship.owner,
        state.scenarioRules.targetWinRequiresPassengers
          ? `Landed on ${targetBody} with colonists!`
          : `Landed on ${targetBody}!`,
        engineEvents,
      );
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

    const escapeReason = ship.identity?.hasFugitives
      ? hexVecLength(ship.velocity) + 1 <= ship.fuel
        ? 'Pilgrims decisive victory — the fugitives escaped beyond Jupiter with fuel to spare!'
        : 'Pilgrims marginal victory — the fugitives escaped beyond Jupiter!'
      : 'Escaped the solar system!';

    setGameOutcome(state, ship.owner, escapeReason, engineEvents);
    return;
  }
};

export const getFugitiveShip = (state: GameState): Ship | undefined =>
  state.ships.find((ship) => ship.identity?.hasFugitives);

const checkPassengerObjectiveFailure = (
  state: GameState,
  engineEvents?: EngineEvent[],
): boolean => {
  if (!state.scenarioRules.targetWinRequiresPassengers) {
    return false;
  }

  for (const [playerId, player] of state.players.entries()) {
    if (!player.targetBody) {
      continue;
    }

    const hasSurvivingPassengers = state.ships.some(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        (ship.passengersAboard ?? 0) > 0,
    );

    if (hasSurvivingPassengers) {
      continue;
    }

    setGameOutcome(
      state,
      (playerId === 0 ? 1 : 0) as PlayerId,
      `Passenger objective failed — no colonists remain for ${player.targetBody}.`,
      engineEvents,
    );
    return true;
  }

  return false;
};

// Check if the game has ended (victory or all ships destroyed).
export const checkGameEnd = (
  state: GameState,
  map?: SolarSystemMap,
  engineEvents?: EngineEvent[],
): void => {
  checkImmediateVictory(state, map, engineEvents);

  if (state.outcome !== null) {
    return;
  }

  if (usesEscapeInspectionRules(state)) {
    const fugitive = getFugitiveShip(state);

    if (fugitive?.lifecycle === 'destroyed') {
      if (state.escapeMoralVictoryAchieved) {
        setGameOutcome(
          state,
          fugitive.owner,
          'Pilgrims moral victory — the fugitives were lost, but they crippled an Enforcer ship.',
          engineEvents,
        );
      } else {
        const opponent: PlayerId = fugitive.owner === 0 ? 1 : 0;
        setGameOutcome(
          state,
          opponent,
          'Enforcers marginal victory — the fugitive transport was destroyed.',
          engineEvents,
        );
      }
      return;
    }

    if (map && hasReturnedCapturedFugitivesToBase(state, map)) {
      const fugitiveOriginalOwner = fugitive?.originalOwner ?? 1;

      if (state.escapeMoralVictoryAchieved) {
        setGameOutcome(
          state,
          fugitiveOriginalOwner,
          'Pilgrims moral victory — the fugitives were captured, but they crippled an Enforcer ship.',
          engineEvents,
        );
      } else {
        setGameOutcome(
          state,
          (fugitiveOriginalOwner === 0 ? 1 : 0) as PlayerId,
          'Enforcers decisive victory — the fugitives were captured and returned to base.',
          engineEvents,
        );
      }
      return;
    }

    return;
  }

  if (checkPassengerObjectiveFailure(state, engineEvents)) {
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
    setGameOutcome(
      state,
      (state.activePlayer === 0 ? 1 : 0) as PlayerId,
      'Mutual destruction — last attacker loses!',
      engineEvents,
    );
    return;
  }

  if (alive0 === 0) {
    setGameOutcome(state, 1, 'Fleet eliminated!', engineEvents);
    return;
  }

  if (alive1 === 0) {
    setGameOutcome(state, 0, 'Fleet eliminated!', engineEvents);
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
        (ship.lifecycle === 'destroyed' || ship.damage.disabledTurns >= 2),
    )
  ) {
    state.escapeMoralVictoryAchieved = true;
  }
};
