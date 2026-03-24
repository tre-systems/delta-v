import { SHIP_STATS } from '../../shared/constants';
import type {
  CombatResult,
  MovementEvent,
  Ship,
} from '../../shared/types/domain';
import type { LogisticsTransferLogEvent } from '../../shared/types/protocol';

export interface ParsedJoinInput {
  code: string;
  playerToken: string | null;
}

export interface UITextStatus {
  text: string;
  className: string;
}

export interface PhaseAlertCopy {
  title: string;
  subtitle: string;
  subtitleColor: string;
}

export interface LogEntryView {
  text: string;
  className: string;
}

const getShipName = (ship: Ship | null, fallback: string): string => {
  return ship ? (SHIP_STATS[ship.type]?.name ?? ship.type) : fallback;
};

const formatDamageResult = (
  damageType: string,
  disabledTurns: number,
  missLabel = 'Miss',
): string => {
  if (damageType === 'eliminated') return 'DESTROYED';

  if (damageType === 'disabled') {
    return `DISABLED (${disabledTurns}T)`;
  }

  return missLabel;
};

export const parseJoinInput = (
  rawValue: string,
  codeLength: number,
): ParsedJoinInput | null => {
  const trimmed = rawValue.trim();

  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code')?.toUpperCase() ?? '';
    const playerToken = url.searchParams.get('playerToken');

    if (code.length === codeLength) {
      return { code, playerToken };
    }
  } catch {
    // Not a URL — fall through to raw code handling.
  }

  const code = trimmed.toUpperCase();

  return code.length === codeLength ? { code, playerToken: null } : null;
};

export const getLatencyStatus = (latencyMs: number | null): UITextStatus => {
  if (latencyMs === null) {
    return { text: '', className: 'latency-text' };
  }

  return {
    text: `${latencyMs}ms`,
    className: `latency-text ${
      latencyMs < 100
        ? 'latency-good'
        : latencyMs < 250
          ? 'latency-ok'
          : 'latency-bad'
    }`,
  };
};

export const getPhaseAlertCopy = (
  phase: string,
  isMyTurn: boolean,
): PhaseAlertCopy => {
  const title =
    phase === 'astrogation'
      ? 'Astrogation'
      : phase === 'ordnance'
        ? 'Ordnance'
        : phase === 'combat'
          ? 'Combat'
          : phase;

  return {
    title,
    subtitle: isMyTurn ? 'YOUR TURN' : "OPPONENT'S TURN",
    subtitleColor: isMyTurn ? 'var(--accent)' : 'var(--warning)',
  };
};

export const formatMovementEventEntry = (
  event: MovementEvent,
  ships: Ship[],
): LogEntryView | null => {
  const ship = ships.find((candidate) => candidate.id === event.shipId) ?? null;
  const name = getShipName(ship, event.shipId);

  switch (event.type) {
    case 'crash':
      return {
        text: `${name} crashed and was LOST!`,
        className: 'log-eliminated',
      };

    case 'ramming':
      return {
        text: `${name} collided with another ship! [Roll: ${event.dieRoll}] -> ${
          event.damageType === 'eliminated'
            ? 'Eliminated!'
            : event.damageType === 'disabled'
              ? `Disabled for ${event.disabledTurns} turns`
              : 'Survives'
        }`,
        className:
          event.damageType === 'eliminated'
            ? 'log-eliminated'
            : event.damageType === 'disabled'
              ? 'log-damage'
              : 'log-env',
      };

    case 'asteroidHit':
      return {
        text: `${name} struck an asteroid! [Roll: ${event.dieRoll}] -> ${
          event.damageType === 'eliminated'
            ? 'Hull breached, Ship Lost!'
            : event.damageType === 'disabled'
              ? `Systems disabled for ${event.disabledTurns}T`
              : 'Glancing blow, no damage'
        }`,
        className:
          event.damageType === 'eliminated'
            ? 'log-eliminated'
            : event.damageType === 'disabled'
              ? 'log-damage'
              : 'log-env',
      };

    case 'mineDetonation':
      return {
        text: `Mine detonated near ${name}! [Roll: ${event.dieRoll}] -> ${
          event.damageType === 'eliminated'
            ? 'Vessel destroyed!'
            : event.damageType === 'disabled'
              ? `Disabled for ${event.disabledTurns}T`
              : 'Armor held'
        }`,
        className:
          event.damageType === 'eliminated'
            ? 'log-eliminated'
            : event.damageType === 'disabled'
              ? 'log-damage'
              : '',
      };

    case 'torpedoHit':
      return {
        text: `Torpedo impact on ${name}! [Roll: ${event.dieRoll}] -> ${
          event.damageType === 'eliminated'
            ? 'Critical detonation, vessel lost'
            : event.damageType === 'disabled'
              ? `Systems disabled for ${event.disabledTurns}T`
              : 'Deflected'
        }`,
        className:
          event.damageType === 'eliminated'
            ? 'log-eliminated'
            : event.damageType === 'disabled'
              ? 'log-damage'
              : '',
      };

    case 'nukeDetonation':
      return {
        text: `Nuclear detonation near ${name}! [Roll: ${event.dieRoll}] -> ${
          event.damageType === 'eliminated'
            ? 'Ship vaporized!'
            : event.damageType === 'disabled'
              ? `Disabled for ${event.disabledTurns}T`
              : 'Radiation shield held'
        }`,
        className:
          event.damageType === 'eliminated'
            ? 'log-eliminated'
            : event.damageType === 'disabled'
              ? 'log-damage'
              : '',
      };

    case 'capture': {
      const captor = event.capturedBy
        ? (ships.find((candidate) => candidate.id === event.capturedBy) ?? null)
        : null;
      const captorName = getShipName(captor, 'unknown');

      return {
        text: `${name} has been CAPTURED by ${captorName}!`,
        className: 'log-damage',
      };
    }

    default:
      return null;
  }
};

const getCombatAttackerDescription = (
  result: CombatResult,
  ships: Ship[],
): string => {
  if (result.attackType === 'baseDefense') {
    return 'Planetary Base';
  }

  if (result.attackType === 'antiNuke') {
    return 'Defensive Battery';
  }

  if (result.attackType === 'asteroidHazard') {
    return '';
  }

  const attackerNames = result.attackerIds
    .map((id) => {
      const ship = ships.find((candidate) => candidate.id === id) ?? null;

      return getShipName(ship, id);
    })
    .filter((name, index, values) => values.indexOf(name) === index);

  return attackerNames.join(' & ');
};

export const formatCombatResultEntries = (
  result: CombatResult,
  ships: Ship[],
  playerId: number,
): LogEntryView[] => {
  const entries: LogEntryView[] = [];

  const target =
    result.targetType === 'ship'
      ? (ships.find((ship) => ship.id === result.targetId) ?? null)
      : null;

  const targetName =
    result.targetType === 'ordnance'
      ? 'nuke'
      : getShipName(target, result.targetId);

  const isPlayerTarget = target?.owner === playerId;

  const className =
    result.damageType === 'eliminated'
      ? 'log-eliminated'
      : result.damageType === 'disabled'
        ? 'log-damage'
        : isPlayerTarget
          ? 'log-enemy'
          : '';

  if (result.attackType === 'asteroidHazard') {
    entries.push({
      text: `${targetName} struck an asteroid: ${formatDamageResult(result.damageType, result.disabledTurns)} [Roll: ${result.dieRoll}]`,
      className: className || 'log-env',
    });
  } else {
    const mods = [];

    if (result.rangeMod !== 0) {
      const absMod = Math.abs(result.rangeMod);
      mods.push(`Range ${absMod} (-${absMod})`);
    }

    if (result.velocityMod !== 0) {
      const absMod = Math.abs(result.velocityMod);
      mods.push(`Velocity ${absMod + 2} (-${absMod})`);
    }

    const modText = mods.length > 0 ? ` (${mods.join(', ')})` : '';

    entries.push({
      text: `${getCombatAttackerDescription(result, ships)} fired on ${targetName} [Odds: ${result.odds}${modText}] -> Roll: ${result.dieRoll} -> ${formatDamageResult(result.damageType, result.disabledTurns)}`,
      className,
    });
  }

  if (result.counterattack) {
    const counterTarget =
      ships.find((ship) => ship.id === result.counterattack?.targetId) ?? null;

    entries.push({
      text: `  Target returned fire on ${getShipName(counterTarget, result.counterattack.targetId)}: ${formatDamageResult(result.counterattack.damageType, result.counterattack.disabledTurns)}`,
      className:
        result.counterattack.damageType === 'eliminated'
          ? 'log-eliminated'
          : result.counterattack.damageType === 'disabled'
            ? 'log-damage'
            : '',
    });
  }

  return entries;
};

/** Human-readable lines for logistics transfer events (local / AI / network stateUpdate). */
export const formatLogisticsTransferLogLines = (
  events: readonly LogisticsTransferLogEvent[],
  ships: Ship[],
): string[] => {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === 'fuelTransferred') {
      const from = getShipName(
        ships.find((s) => s.id === e.fromShipId) ?? null,
        e.fromShipId,
      );
      const to = getShipName(
        ships.find((s) => s.id === e.toShipId) ?? null,
        e.toShipId,
      );
      lines.push(`Transferred ${e.amount} fuel: ${from} → ${to}`);
    } else if (e.type === 'cargoTransferred') {
      const from = getShipName(
        ships.find((s) => s.id === e.fromShipId) ?? null,
        e.fromShipId,
      );
      const to = getShipName(
        ships.find((s) => s.id === e.toShipId) ?? null,
        e.toShipId,
      );
      lines.push(`Transferred ${e.amount} cargo mass: ${from} → ${to}`);
    } else if (e.type === 'passengersTransferred') {
      const from = getShipName(
        ships.find((s) => s.id === e.fromShipId) ?? null,
        e.fromShipId,
      );
      const to = getShipName(
        ships.find((s) => s.id === e.toShipId) ?? null,
        e.toShipId,
      );
      lines.push(`Transferred ${e.amount} passengers: ${from} → ${to}`);
    }
  }
  return lines;
};
