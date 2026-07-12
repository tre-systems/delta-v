// Structured "what is legal right now" metadata for agents.
// Keeps LLMs off-leash from inventing illegal ship IDs or phase-wrong actions.

import { isUnlimited, SHIP_STATS } from '../constants';
import type { GameState, PlayerId } from '../types/domain';
import { allowedActionTypesForPhase } from './candidates';
import { DIRECTION_NAMES } from './describe';
import type {
  LegalActionEnemyInfo,
  LegalActionInfo,
  LegalActionShipInfo,
} from './types';

export const buildLegalActionInfo = (
  state: GameState,
  playerId: PlayerId,
): LegalActionInfo => {
  const opponentId = playerId === 0 ? 1 : 0;
  const allowedTypes =
    state.phase === 'fleetBuilding' && state.players[playerId].ready
      ? []
      : [...allowedActionTypesForPhase(state.phase)];

  const ownShips: LegalActionShipInfo[] = state.ships
    .filter((s) => s.owner === playerId && s.lifecycle !== 'destroyed')
    .map((s) => {
      const stats = SHIP_STATS[s.type];
      const isActive = s.lifecycle === 'active';
      const canManeuver =
        (isActive || s.lifecycle === 'landed') && s.damage.disabledTurns === 0;
      const isOperational =
        s.damage.disabledTurns === 0 ||
        stats.operatesAtD1 ||
        stats.operatesWhileDisabled;
      return {
        id: s.id,
        type: s.type,
        position: { q: s.position.q, r: s.position.r },
        velocity: { dq: s.velocity.dq, dr: s.velocity.dr },
        fuel: s.fuel,
        lifecycle: s.lifecycle,
        canBurn: canManeuver && s.fuel > 0,
        canOverload:
          canManeuver && stats.canOverload && !s.overloadUsed && s.fuel >= 2,
        canAttack:
          isActive &&
          isOperational &&
          !stats.defensiveOnly &&
          !s.resuppliedThisTurn,
        canLaunchOrdnance:
          isActive &&
          isOperational &&
          !s.resuppliedThisTurn &&
          s.cargoUsed < stats.cargo,
        cargoUsed: s.cargoUsed,
        cargoCapacity: isUnlimited(stats.cargo) ? -1 : stats.cargo,
        passengersAboard: s.passengersAboard ?? 0,
        disabledTurns: s.damage.disabledTurns,
      };
    });

  const enemies: LegalActionEnemyInfo[] = state.ships
    .filter((s) => s.owner === opponentId && s.lifecycle !== 'destroyed')
    .map((s) => ({
      id: s.id,
      type: s.type,
      position: { q: s.position.q, r: s.position.r },
      velocity: { dq: s.velocity.dq, dr: s.velocity.dr },
      lifecycle: s.lifecycle,
      detected: s.detected,
    }));

  return {
    phase: state.phase,
    allowedTypes,
    burnDirections: [...DIRECTION_NAMES],
    ownShips,
    enemies,
  };
};
