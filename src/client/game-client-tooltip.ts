import { SHIP_STATS } from '../shared/constants';
import { canAttack, computeGroupRangeMod, computeGroupVelocityMod, computeOdds, getCombatStrength, hasLineOfSight } from '../shared/combat';
import { hexVecLength } from '../shared/hex';
import type { GameState, Ship, SolarSystemMap } from '../shared/types';

function getCombatSummary(state: GameState, ship: Ship, playerId: number, map: SolarSystemMap) {
  if (ship.owner === playerId) {
    return '';
  }

  const attackers = state.ships
    .filter((candidate) => candidate.owner === playerId && !candidate.destroyed && canAttack(candidate))
    .filter((candidate) => hasLineOfSight(candidate, ship, map));
  if (attackers.length === 0) {
    return '';
  }

  const attackStrength = getCombatStrength(attackers);
  const defendStrength = getCombatStrength([ship]);
  const odds = computeOdds(attackStrength, defendStrength);
  const rangeMod = computeGroupRangeMod(attackers, ship);
  const velocityMod = computeGroupVelocityMod(attackers, ship);
  return `<div class="tt-warn">${odds} R-${rangeMod} V-${velocityMod}</div>`;
}

export function buildShipTooltipHtml(
  state: GameState,
  ship: Ship,
  playerId: number,
  map: SolarSystemMap,
): string {
  const stats = SHIP_STATS[ship.type];
  const name = stats?.name ?? ship.type;
  const isEnemy = ship.owner !== playerId;
  const nameClass = isEnemy ? 'tt-enemy' : 'tt-name';
  const speed = hexVecLength(ship.velocity);
  const combat = stats ? `${stats.combat}${stats.defensiveOnly ? 'D' : ''}` : '?';
  const parts = [
    `<div class="${nameClass}">${name}</div>`,
    `<div class="tt-stat">Combat: ${combat}</div>`,
    `<div class="tt-stat">Speed: ${speed.toFixed(1)}</div>`,
  ];

  if (!isEnemy) {
    parts.push(`<div class="tt-stat">Fuel: ${ship.fuel}/${stats?.fuel ?? '?'}</div>`);
    if (stats && stats.cargo > 0) {
      parts.push(`<div class="tt-stat">Cargo: ${stats.cargo - ship.cargoUsed}/${stats.cargo}</div>`);
    }
  }
  if (ship.damage.disabledTurns > 0) {
    parts.push(`<div class="tt-warn">Disabled: ${ship.damage.disabledTurns}T</div>`);
  }
  if (ship.landed) {
    parts.push('<div class="tt-stat">Landed</div>');
  }

  const combatSummary = getCombatSummary(state, ship, playerId, map);
  if (combatSummary) {
    parts.push(combatSummary);
  }
  return parts.join('');
}
