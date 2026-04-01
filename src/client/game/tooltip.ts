import { SHIP_STATS } from '../../shared/constants';
import { hexVecLength } from '../../shared/hex';
import type {
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';

export const buildShipTooltipHtml = (
  _state: GameState,
  ship: Ship,
  playerId: PlayerId,
  _map: SolarSystemMap,
): string => {
  const stats = SHIP_STATS[ship.type];
  const name = stats?.name ?? ship.type;
  const isEnemy = ship.owner !== playerId;
  const nameClass = isEnemy ? 'tt-enemy' : 'tt-name';
  const speed = hexVecLength(ship.velocity);

  const combat = stats
    ? `${stats.combat}${stats.defensiveOnly ? 'D' : ''}`
    : '?';

  const parts = [
    `<div class="${nameClass}">${name}</div>`,
    `<div class="tt-stat">Combat: ${combat}</div>`,
    `<div class="tt-stat">Speed: ${speed.toFixed(1)}</div>`,
  ];

  if (!isEnemy) {
    parts.push(
      `<div class="tt-stat">Fuel: ${ship.fuel}/${stats?.fuel ?? '?'}</div>`,
    );

    if (stats && stats.cargo > 0) {
      parts.push(
        `<div class="tt-stat">Cargo: ${stats.cargo - ship.cargoUsed}/${stats.cargo}</div>`,
      );
    }
  }

  if (ship.damage.disabledTurns > 0) {
    parts.push(
      `<div class="tt-warn">Disabled: ${ship.damage.disabledTurns}T</div>`,
    );
  }

  if (ship.lifecycle === 'landed') {
    parts.push('<div class="tt-stat">Landed</div>');
  }

  return parts.join('');
};
