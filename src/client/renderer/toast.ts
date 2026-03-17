import type { CombatResult, GameState, MovementEvent } from '../../shared/types';
import { formatCombatResult } from './combat';

export interface ToastLine {
  text: string;
  color: string;
  variant: 'primary' | 'secondary';
}

const getResultColor = (damageType: CombatResult['damageType']): string => {
  return damageType === 'eliminated' ? '#ff4444' : damageType === 'disabled' ? '#ffaa00' : '#88ff88';
};

const getMovementDamageText = (event: MovementEvent, missLabel: string): string => {
  return event.damageType === 'eliminated'
    ? 'ELIMINATED'
    : event.damageType === 'disabled'
      ? `DISABLED ${event.disabledTurns}T`
      : missLabel;
};

const getMovementDamageColor = (event: MovementEvent): string => {
  return event.damageType === 'eliminated' ? '#ff4444' : event.damageType === 'disabled' ? '#ffaa00' : '#88ff88';
};

export const getToastFadeAlpha = (showUntil: number, now: number): number => {
  const fadeStart = showUntil - 1000;
  return now > fadeStart ? Math.max(0, (showUntil - now) / 1000) : 1;
};

export const formatMovementEventToast = (event: MovementEvent, shipName: string): ToastLine | null => {
  switch (event.type) {
    case 'crash':
      return { text: `${shipName}: CRASHED`, color: '#ff4444', variant: 'primary' };
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

export const buildCombatResultToastLines = (results: CombatResult[], state: GameState): ToastLine[] => {
  const lines: ToastLine[] = [];
  for (const result of results) {
    lines.push({
      text: formatCombatResult(result, state),
      color: getResultColor(result.damageType),
      variant: 'primary',
    });
    if (result.counterattack) {
      lines.push({
        text: formatCombatResult(result.counterattack, state),
        color: getResultColor(result.counterattack.damageType),
        variant: 'secondary',
      });
    }
  }
  return lines;
};
