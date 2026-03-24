import type {
  CombatResult,
  GameState,
  MovementEvent,
} from '../../shared/types/domain';
import { matchEqOr } from '../../shared/util';
import { formatCombatResult } from './combat';

export interface ToastLine {
  text: string;
  color: string;
  variant: 'primary' | 'secondary';
}

const getResultColor = (damageType: CombatResult['damageType']): string =>
  matchEqOr(
    damageType,
    '#88ff88',
    ['eliminated', '#ff4444'],
    ['disabled', '#ffaa00'],
  );

const getMovementDamageText = (
  event: MovementEvent,
  missLabel: string,
): string =>
  matchEqOr(
    event.damageType,
    missLabel,
    ['eliminated', 'ELIMINATED'],
    ['disabled', `DISABLED ${event.disabledTurns}T`],
  );

const getMovementDamageColor = (event: MovementEvent): string =>
  matchEqOr(
    event.damageType,
    '#88ff88',
    ['eliminated', '#ff4444'],
    ['disabled', '#ffaa00'],
  );

export const getToastFadeAlpha = (showUntil: number, now: number): number =>
  now > showUntil - 1000 ? Math.max(0, (showUntil - now) / 1000) : 1;

export const formatMovementEventToast = (
  event: MovementEvent,
  shipName: string,
): ToastLine | null => {
  switch (event.type) {
    case 'crash':
      return {
        text: `${shipName}: CRASHED`,
        color: '#ff4444',
        variant: 'primary',
      };

    case 'ramming':
      return {
        text: `${shipName}: RAMMED [${event.dieRoll}] — ${getMovementDamageText(event, 'NO DAMAGE')}`,
        color: getMovementDamageColor(event),
        variant: 'primary',
      };

    case 'asteroidHit':
      return {
        text: `${shipName}: Asteroid hit [${event.dieRoll}] — ${getMovementDamageText(event, 'MISS')}`,
        color: getMovementDamageColor(event),
        variant: 'primary',
      };

    case 'mineDetonation':
      return {
        text: `Mine hit ${shipName} [${event.dieRoll}] — ${getMovementDamageText(event, 'NO EFFECT')}`,
        color: getMovementDamageColor(event),
        variant: 'primary',
      };

    case 'torpedoHit':
      return {
        text: `Torpedo hit ${shipName} [${event.dieRoll}] — ${getMovementDamageText(event, 'NO EFFECT')}`,
        color: getMovementDamageColor(event),
        variant: 'primary',
      };

    case 'nukeDetonation':
      return {
        text: `NUKE hit ${shipName} [${event.dieRoll}] — ${getMovementDamageText(event, 'NO EFFECT')}`,
        color: getMovementDamageColor(event),
        variant: 'primary',
      };

    default:
      return null;
  }
};

export const buildCombatResultToastLines = (
  results: CombatResult[],
  state: GameState,
): ToastLine[] =>
  results.flatMap((result) => {
    const primary: ToastLine = {
      text: formatCombatResult(result, state),
      color: getResultColor(result.damageType),
      variant: 'primary',
    };

    if (!result.counterattack) {
      return [primary];
    }

    return [
      primary,
      {
        text: formatCombatResult(result.counterattack, state),
        color: getResultColor(result.counterattack.damageType),
        variant: 'secondary',
      },
    ];
  });
