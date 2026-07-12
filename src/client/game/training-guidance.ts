import { hexDistance } from '../../shared/hex';
import { computeCourse } from '../../shared/movement';
import type {
  GameState,
  PlayerId,
  Ship,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import { chooseSteerBurn } from './fleet-steer';
import { getObjectiveBearingTargetHex } from './navigation';

export const deriveTrainingFirstBurnDirection = (
  state: GameState,
  playerId: PlayerId,
  ship: Ship,
  map: SolarSystemMap,
): number | null => {
  if (
    state.turnNumber !== 1 ||
    state.phase !== 'astrogation' ||
    state.activePlayer !== playerId ||
    ship.owner !== playerId
  ) {
    return null;
  }

  const target = getObjectiveBearingTargetHex(state, playerId, map, ship);
  if (!target) return null;

  const steeringChoice = chooseSteerBurn(
    ship,
    target,
    map,
    state.destroyedBases,
  );
  if (typeof steeringChoice === 'number') {
    return steeringChoice;
  }

  let best: { direction: number; distance: number } | null = null;
  for (let direction = 0; direction < 6; direction += 1) {
    const course = computeCourse(ship, direction, map, {
      destroyedBases: state.destroyedBases,
    });
    if (course.outcome === 'crash') continue;
    const distance = hexDistance(course.destination, target);
    if (!best || distance < best.distance) {
      best = { direction, distance };
    }
  }

  return best?.direction ?? null;
};

export const deriveTrainingMovementFeedback = (
  state: GameState,
  playerId: PlayerId,
  movements: ShipMovement[],
  map: SolarSystemMap,
): string | null => {
  const movement = movements.find((candidate) => {
    const ship = state.ships.find((entry) => entry.id === candidate.shipId);
    return ship?.owner === playerId;
  });
  if (!movement) return null;

  const ship = state.ships.find((entry) => entry.id === movement.shipId);
  if (!ship) return null;
  const target = getObjectiveBearingTargetHex(state, playerId, map, ship);
  if (!target) return null;

  const targetName = state.players[playerId]?.targetBody ?? 'the objective';
  if (movement.outcome === 'landing') {
    return movement.landedAt === targetName
      ? `Flight coach: You landed at ${targetName} — landing on the enemy world wins this race.`
      : `Flight coach: You landed at ${movement.landedAt}. Take off again when you are ready to continue toward ${targetName}.`;
  }

  if (movement.outcome === 'crash') {
    return 'Flight coach: That course crashed. Before confirming, use Undo whenever the course summary warns CRASH.';
  }

  const beforeDistance = hexDistance(movement.from, target);
  const afterDistance = hexDistance(movement.to, target);
  const nextDrift = computeCourse(ship, null, map, {
    destroyedBases: state.destroyedBases,
  });
  if (nextDrift.outcome === 'crash') {
    return `Flight coach: This burn moved you toward ${targetName}, but drifting next turn would crash into ${nextDrift.crashBody}. Choose a burn that clears the CRASH warning.`;
  }
  const nextDriftDistance = hexDistance(nextDrift.destination, target);

  if (afterDistance < beforeDistance && nextDriftDistance < afterDistance) {
    return `Flight coach: Good — your velocity now carries you toward ${targetName}. Drifting next turn keeps that momentum for free.`;
  }
  if (afterDistance < beforeDistance) {
    return `Flight coach: Good — this move brought you closer to ${targetName}. Check the next dashed route before choosing another burn.`;
  }
  if (afterDistance > beforeDistance) {
    return `Flight coach: You moved farther from ${targetName}. Use the objective arrow and burn back toward it next turn.`;
  }

  return `Flight coach: You moved across the route to ${targetName}. Check where your velocity carries you before confirming the next turn.`;
};
