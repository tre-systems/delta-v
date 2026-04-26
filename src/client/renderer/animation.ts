import { MOVEMENT_ANIM_DURATION } from '../../shared/constants';
import type { HexCoord } from '../../shared/hex';
import type { OrdnanceMovement, ShipMovement } from '../../shared/types/domain';

const MAX_TRAIL_POINTS_PER_ENTITY = 96;

export interface AnimationState {
  movements: ShipMovement[];
  ordnanceMovements: OrdnanceMovement[];
  startTime: number;
  duration: number;
  onComplete: () => void;
}

interface MovementAnimationDeps {
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  isDocumentHidden?: () => boolean;
  durationMs?: number;
}

export interface MovementAnimationManager {
  getAnimationState: () => AnimationState | null;
  getShipTrails: () => Map<string, HexCoord[]>;
  getOrdnanceTrails: () => Map<string, HexCoord[]>;
  clearTrails: () => void;
  isAnimating: () => boolean;
  start: (
    movements: ShipMovement[],
    ordnanceMovements: OrdnanceMovement[],
    onComplete: () => void,
  ) => void;
  completeIfElapsed: (now?: number) => void;
  handleVisibilityChange: (
    visibilityState: DocumentVisibilityState,
    now?: number,
  ) => void;
}

const appendTrailPath = (
  trails: Map<string, HexCoord[]>,
  id: string,
  path: HexCoord[],
): void => {
  const existing = trails.get(id);

  if (!existing) {
    trails.set(id, path.slice(-MAX_TRAIL_POINTS_PER_ENTITY));
    return;
  }

  const start =
    existing.length > 0 &&
    path.length > 0 &&
    existing[existing.length - 1].q === path[0].q &&
    existing[existing.length - 1].r === path[0].r
      ? 1
      : 0;

  for (let i = start; i < path.length; i++) {
    existing.push(path[i]);
  }

  if (existing.length > MAX_TRAIL_POINTS_PER_ENTITY) {
    existing.splice(0, existing.length - MAX_TRAIL_POINTS_PER_ENTITY);
  }
};

export const getAnimationProgress = (
  animationState: AnimationState,
  now: number,
): number => {
  return Math.min(
    (now - animationState.startTime) / animationState.duration,
    1,
  );
};

export const collectAnimatedHexes = (
  movements: ShipMovement[],
  ordnanceMovements: OrdnanceMovement[],
): HexCoord[] => {
  return [
    ...movements.map((movement) => movement.from),
    ...ordnanceMovements.map((movement) => movement.from),
    ...movements.map((movement) => movement.to),
    ...ordnanceMovements.map((movement) => movement.to),
  ];
};

export const createMovementAnimationManager = ({
  now = () => performance.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  isDocumentHidden = () => document.hidden,
  durationMs = MOVEMENT_ANIM_DURATION,
}: MovementAnimationDeps = {}): MovementAnimationManager => {
  let animationState: AnimationState | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const shipTrails = new Map<string, HexCoord[]>();
  const ordnanceTrails = new Map<string, HexCoord[]>();

  const clearFallbackTimer = (): void => {
    if (fallbackTimer === null) {
      return;
    }

    clearTimeoutFn(fallbackTimer);
    fallbackTimer = null;
  };

  const completeAnimation = (): void => {
    clearFallbackTimer();

    if (!animationState) {
      return;
    }

    const onComplete = animationState.onComplete;
    animationState = null;
    onComplete();
  };

  const recordTrails = (
    movements: ShipMovement[],
    ordnanceMovements: OrdnanceMovement[],
  ): void => {
    for (const movement of movements) {
      appendTrailPath(shipTrails, movement.shipId, movement.path);
    }

    for (const movement of ordnanceMovements) {
      appendTrailPath(ordnanceTrails, movement.ordnanceId, movement.path);
    }
  };

  const start = (
    movements: ShipMovement[],
    ordnanceMovements: OrdnanceMovement[],
    onComplete: () => void,
  ): void => {
    recordTrails(movements, ordnanceMovements);
    clearFallbackTimer();
    animationState = null;

    if (isDocumentHidden()) {
      onComplete();
      return;
    }

    animationState = {
      movements,
      ordnanceMovements,
      startTime: now(),
      duration: durationMs,
      onComplete,
    };

    fallbackTimer = setTimeoutFn(() => {
      fallbackTimer = null;
      completeAnimation();
    }, durationMs + 500);
  };

  const completeIfElapsed = (currentNow = now()): void => {
    if (!animationState) {
      return;
    }

    if (currentNow - animationState.startTime >= animationState.duration) {
      completeAnimation();
    }
  };

  const handleVisibilityChange = (
    visibilityState: DocumentVisibilityState,
    currentNow = now(),
  ): void => {
    if (!animationState) {
      return;
    }

    if (
      visibilityState === 'hidden' ||
      currentNow - animationState.startTime >= animationState.duration
    ) {
      completeAnimation();
    }
  };

  return {
    getAnimationState: () => animationState,
    getShipTrails: () => shipTrails,
    getOrdnanceTrails: () => ordnanceTrails,
    clearTrails: () => {
      shipTrails.clear();
      ordnanceTrails.clear();
    },
    isAnimating: () => animationState !== null,
    start,
    completeIfElapsed,
    handleVisibilityChange,
  };
};
