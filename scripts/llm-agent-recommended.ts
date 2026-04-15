type Phase =
  | 'fleetBuilding'
  | 'astrogation'
  | 'ordnance'
  | 'combat'
  | 'logistics';

interface Position {
  q: number;
  r: number;
}

interface ShipLike {
  owner: 0 | 1;
  lifecycle: 'operational' | 'disabled' | 'destroyed';
  position: Position;
}

interface StateLike {
  turnNumber: number;
  phase: Phase | string;
  activePlayer: 0 | 1;
  ships?: ShipLike[];
}

interface OrdnanceLaunch {
  ordnanceType: 'mine' | 'torpedo' | 'nuke';
}

interface CandidateAction {
  type: string;
  launches?: OrdnanceLaunch[];
}

interface CandidatePayload {
  recommendedIndex?: number;
  playerId?: 0 | 1;
  state?: StateLike;
  candidates?: CandidateAction[];
}

const hexDistance = (left: Position, right: Position): number =>
  Math.max(
    Math.abs(left.q - right.q),
    Math.abs(left.r - right.r),
    Math.abs(left.q + left.r - right.q - right.r),
  );

const pickSaferOrdnanceIndex = (
  payload: CandidatePayload,
  fallback: number,
): number => {
  if (
    payload.playerId === undefined ||
    payload.state === undefined ||
    !Array.isArray(payload.state.ships) ||
    !Array.isArray(payload.candidates)
  ) {
    return fallback;
  }
  if (payload.state.phase !== 'ordnance' || payload.state.turnNumber > 2) {
    return fallback;
  }
  if (fallback < 0 || fallback >= payload.candidates.length) return 0;

  const ownShips = payload.state.ships.filter(
    (ship) => ship.owner === payload.playerId && ship.lifecycle !== 'destroyed',
  );
  const enemyShips = payload.state.ships.filter(
    (ship) => ship.owner !== payload.playerId && ship.lifecycle !== 'destroyed',
  );
  let nearestEnemyDistance: number | null = null;
  for (const own of ownShips) {
    for (const enemy of enemyShips) {
      const d = hexDistance(own.position, enemy.position);
      nearestEnemyDistance =
        nearestEnemyDistance === null ? d : Math.min(nearestEnemyDistance, d);
    }
  }
  const materialEdge = ownShips.length - enemyShips.length;

  const selected = payload.candidates[fallback];
  if (selected.type !== 'ordnance' || !Array.isArray(selected.launches)) {
    return fallback;
  }
  const hasNuke = selected.launches.some((l) => l.ordnanceType === 'nuke');
  const hasTorpedo = selected.launches.some(
    (l) => l.ordnanceType === 'torpedo',
  );
  const hasMine = selected.launches.some((l) => l.ordnanceType === 'mine');

  const riskyEarlyNuke =
    hasNuke && (nearestEnemyDistance === null || nearestEnemyDistance > 1);
  const riskyEarlyTorpedo =
    hasTorpedo && (nearestEnemyDistance === null || nearestEnemyDistance > 4);
  const riskyEarlyMine =
    hasMine && (nearestEnemyDistance === null || nearestEnemyDistance > 2);
  const riskyParityCommit =
    ownShips.length <= 1 &&
    materialEdge <= 0 &&
    nearestEnemyDistance !== null &&
    nearestEnemyDistance > 1;
  if (
    !riskyEarlyNuke &&
    !riskyEarlyTorpedo &&
    !riskyEarlyMine &&
    !riskyParityCommit
  ) {
    return fallback;
  }

  const saferIndex = payload.candidates.findIndex((candidate) => {
    if (candidate.type === 'skipOrdnance') return true;
    if (candidate.type !== 'ordnance' || !Array.isArray(candidate.launches))
      return false;
    const candidateHasNuke = candidate.launches.some(
      (l) => l.ordnanceType === 'nuke',
    );
    const candidateHasTorpedo = candidate.launches.some(
      (l) => l.ordnanceType === 'torpedo',
    );
    const candidateHasMine = candidate.launches.some(
      (l) => l.ordnanceType === 'mine',
    );
    if (candidateHasNuke) return false;
    if (
      candidateHasTorpedo &&
      (nearestEnemyDistance === null || nearestEnemyDistance > 4)
    )
      return false;
    if (
      candidateHasMine &&
      (nearestEnemyDistance === null || nearestEnemyDistance > 2)
    )
      return false;
    return true;
  });
  return saferIndex >= 0 ? saferIndex : fallback;
};

const main = async (): Promise<void> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }

  const raw = chunks.join('').trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  let payload: CandidatePayload;
  try {
    payload = JSON.parse(raw) as CandidatePayload;
  } catch {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  const candidateIndex =
    typeof payload.recommendedIndex === 'number' &&
    Number.isInteger(payload.recommendedIndex) &&
    payload.recommendedIndex >= 0
      ? payload.recommendedIndex
      : 0;

  process.stdout.write(
    JSON.stringify({
      candidateIndex: pickSaferOrdnanceIndex(payload, candidateIndex),
    }),
  );
};

void main().catch(() => {
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});
