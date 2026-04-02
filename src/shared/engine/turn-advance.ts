// Turn advancement: damage recovery, player rotation, reinforcement
// spawning, and fleet conversion. Extracted from victory.ts (backlog #25).

import { SHIP_STATS } from '../constants';
import type { GameState, Ship } from '../types';
import type { EngineEvent } from './engine-events';
import { transitionPhaseWithEvent } from './util';

// Advance to the next player's turn after combat/resupply.
// Handles damage recovery and turn counter.
export const advanceTurn = (
  state: GameState,
  engineEvents?: EngineEvent[],
): void => {
  for (const ship of state.ships) {
    if (ship.owner !== state.activePlayer) continue;

    if (ship.lifecycle === 'destroyed') continue;

    ship.resuppliedThisTurn = false;
    ship.firedThisPhase = undefined;

    if (ship.damage.disabledTurns > 0) {
      ship.damage.disabledTurns--;
    }
  }

  state.activePlayer = state.activePlayer === 0 ? 1 : 0;

  if (state.activePlayer === 0) {
    state.turnNumber++;
  }

  applyReinforcements(state);
  applyFleetConversion(state);

  state.combatTargetedThisPhase = undefined;

  engineEvents?.push({
    type: 'turnAdvanced',
    turn: state.turnNumber,
    activePlayer: state.activePlayer,
  });
  transitionPhaseWithEvent(state, 'astrogation', engineEvents);
};

const getNextShipId = (state: GameState): string => {
  const maxId = state.ships.reduce((max, ship: Ship) => {
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

      const passengersAboard =
        shipDef.initialPassengers != null && shipDef.initialPassengers > 0
          ? shipDef.initialPassengers
          : undefined;
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
        ...(passengersAboard != null ? { passengersAboard } : {}),
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
