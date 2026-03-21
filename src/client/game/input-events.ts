import type { HexCoord } from '../../shared/hex';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import {
  type CombatTargetPlan,
  createCombatTargetPlan,
  getCombatAttackerIdAtHex,
  getCombatTargetAtHex,
  toggleCombatAttackerSelection,
} from './combat';
import type { GameCommand } from './commands';
import { resolveAstrogationClick, resolveOrdnanceClick } from './input';
import type { PlanningState } from './planning';

export type InputEvent =
  | { type: 'clickHex'; hex: HexCoord }
  | { type: 'hoverHex'; hex: HexCoord | null };

const interpretCombatClick = (
  hex: HexCoord,
  state: GameState,
  map: SolarSystemMap | null,
  playerId: number,
  planning: PlanningState,
): GameCommand[] => {
  // Check enemy targets first so mixed hexes prioritise
  // target selection over friendly attacker toggling.
  const target = getCombatTargetAtHex(
    state,
    playerId,
    hex,
    planning.queuedAttacks,
    planning.combatTargetId,
  );

  if (target) {
    const isSame =
      planning.combatTargetId === target.targetId &&
      planning.combatTargetType === target.targetType;

    if (isSame) {
      return [{ type: 'clearCombatSelection' }];
    }

    const plan = createCombatTargetPlan(
      state,
      playerId,
      planning,
      target.targetId,
      target.targetType,
      map,
    );

    return [{ type: 'setCombatPlan', plan }];
  }

  const attackerId = getCombatAttackerIdAtHex(
    state,
    playerId,
    hex,
    planning.selectedShipId,
  );

  if (attackerId) {
    const toggle = toggleCombatAttackerSelection(
      state,
      playerId,
      planning,
      map,
      attackerId,
    );

    if (toggle?.consumed) {
      const plan: CombatTargetPlan = {
        combatTargetId: planning.combatTargetId,
        combatTargetType: planning.combatTargetType,
        combatAttackerIds: toggle.combatAttackerIds,
        combatAttackStrength: toggle.combatAttackStrength,
      };

      return [
        {
          type: 'setCombatPlan',
          plan,
          selectedShipId: attackerId,
        },
      ];
    }
  }

  return [{ type: 'clearCombatSelection' }];
};

const interpretAstrogationClick = (
  hex: HexCoord,
  state: GameState,
  map: SolarSystemMap,
  playerId: number,
  planning: PlanningState,
): GameCommand[] => {
  const interaction = resolveAstrogationClick(
    state,
    map,
    playerId,
    planning,
    hex,
  );

  switch (interaction.type) {
    case 'weakGravityToggle':
      return [
        {
          type: 'setWeakGravityChoices',
          shipId: interaction.shipId,
          choices: interaction.choices,
        },
      ];
    case 'overloadToggle':
      return [
        {
          type: 'setOverloadDirection',
          shipId: interaction.shipId,
          direction: interaction.direction,
        },
      ];
    case 'burnToggle':
      return [
        {
          type: 'setBurnDirection',
          shipId: interaction.shipId,
          direction: interaction.direction,
        },
      ];
    case 'selectShip':
      return [
        {
          type: 'selectShip',
          shipId: interaction.shipId,
        },
      ];
    case 'clearSelection':
      return [{ type: 'deselectShip' }];
  }
};

const interpretOrdnanceClick = (
  hex: HexCoord,
  state: GameState,
  playerId: number,
  planning: PlanningState,
): GameCommand[] => {
  const interaction = resolveOrdnanceClick(state, playerId, planning, hex);

  switch (interaction.type) {
    case 'torpedoAccel':
      return [
        {
          type: 'setTorpedoAccel',
          direction: interaction.torpedoAccel,
          steps: interaction.torpedoAccelSteps,
        },
      ];
    case 'selectShip':
      return [
        {
          type: 'selectShip',
          shipId: interaction.shipId,
        },
        { type: 'clearTorpedoAcceleration' },
      ];
    case 'none':
      return [];
  }
};

const interpretClickHex = (
  hex: HexCoord,
  state: GameState | null,
  map: SolarSystemMap | null,
  playerId: number,
  planning: PlanningState,
): GameCommand[] => {
  if (!state || !map) return [];
  if (state.activePlayer !== playerId) return [];

  switch (state.phase) {
    case 'combat':
      return interpretCombatClick(hex, state, map, playerId, planning);
    case 'ordnance':
      return interpretOrdnanceClick(hex, state, playerId, planning);
    case 'astrogation':
      return interpretAstrogationClick(hex, state, map, playerId, planning);
    default:
      return [];
  }
};

export const interpretInput = (
  event: InputEvent,
  state: GameState | null,
  map: SolarSystemMap | null,
  playerId: number,
  planning: PlanningState,
): GameCommand[] => {
  switch (event.type) {
    case 'clickHex':
      return interpretClickHex(event.hex, state, map, playerId, planning);
    case 'hoverHex':
      if (state) return [{ type: 'setHoverHex', hex: event.hex }];
      if (planning.hoverHex) return [{ type: 'setHoverHex', hex: null }];

      return [];
  }
};
