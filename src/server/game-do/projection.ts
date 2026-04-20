import type { EventEnvelope } from '../../shared/engine/engine-events';
import { projectGameStateFromStream } from '../../shared/engine/event-projector';
import {
  filterStateForPlayer,
  type ViewerId,
} from '../../shared/engine/game-engine';
import { asGameId, type GameId } from '../../shared/ids';
import { buildSolarSystemMap } from '../../shared/map-data';
import {
  parseMatchId,
  type ReplayEntry,
  type ReplayMessage,
  type ReplayTimeline,
  toReplayEntry,
} from '../../shared/replay';
import type { GameState, Phase } from '../../shared/types/domain';
import type { Checkpoint } from './archive';
import { buildReplayMessageFromEvents } from './replay-reconstruct';

const map = buildSolarSystemMap();

export const filterReplayTimelineForViewer = (
  timeline: ReplayTimeline,
  viewerId: ViewerId,
): ReplayTimeline => ({
  ...timeline,
  entries: timeline.entries.map((entry) => ({
    ...entry,
    message: {
      ...entry.message,
      state: filterStateForPlayer(entry.message.state, viewerId),
    },
  })),
});

const toCheckpointReplayEntry = (checkpoint: Checkpoint): ReplayEntry => ({
  sequence: 1,
  recordedAt: checkpoint.savedAt,
  turn: checkpoint.turn,
  phase: checkpoint.phase as Phase,
  message: {
    type: 'stateUpdate',
    state: structuredClone(checkpoint.state),
  } satisfies ReplayMessage,
});

const projectCurrentStateFromStream = (
  eventStreamTail: EventEnvelope[],
  checkpoint: Checkpoint | null,
): GameState | null => {
  const projected = projectGameStateFromStream(
    eventStreamTail,
    map,
    checkpoint?.state ?? null,
  );

  return projected.ok ? projected.value : null;
};

export const getProjectedCurrentStateForViewer = (
  eventStreamTail: EventEnvelope[],
  checkpoint: Checkpoint | null,
  viewerId: ViewerId,
): GameState | null => {
  const latestState = projectCurrentStateFromStream(
    eventStreamTail,
    checkpoint,
  );
  return latestState ? filterStateForPlayer(latestState, viewerId) : null;
};

export const getProjectedCurrentState = (
  eventStreamTail: EventEnvelope[],
  checkpoint: Checkpoint | null,
): GameState | null =>
  projectCurrentStateFromStream(eventStreamTail, checkpoint);

// Events that are part of one movement-resolution or combat-resolution
// batch. Grouping these together lets us reconstruct live-style
// `movementResult`/`combatResult` payloads so archived replays animate
// like a live match. Non-grouping events (game lifecycle, phase changes,
// fleet commits, logistics transfers, etc.) stay as their own entries
// so the replay cadence still reflects discrete user-facing actions.
const MOVEMENT_GROUP_TYPES: ReadonlySet<string> = new Set([
  'shipMoved',
  'shipLanded',
  'shipCrashed',
  'shipDestroyed',
  'shipCaptured',
  'shipResupplied',
  'ordnanceLaunched',
  'ordnanceMoved',
  'ordnanceDetonated',
  'ordnanceDestroyed',
  'ordnanceExpired',
  'ramming',
  'asteroidDestroyed',
  'baseDestroyed',
  'identityRevealed',
  'checkpointVisited',
]);

const COMBAT_GROUP_TYPES: ReadonlySet<string> = new Set([
  'combatAttack',
  'shipDestroyed',
  'ordnanceDestroyed',
  'baseDestroyed',
]);

type BatchKind = 'movement' | 'combat' | null;

const classifyEvent = (eventType: string): BatchKind => {
  if (
    eventType === 'shipMoved' ||
    eventType === 'ordnanceMoved' ||
    eventType === 'ordnanceLaunched'
  ) {
    return 'movement';
  }
  if (eventType === 'combatAttack') {
    return 'combat';
  }
  return null;
};

const canExtendBatch = (kind: BatchKind, eventType: string): boolean => {
  if (kind === 'movement') return MOVEMENT_GROUP_TYPES.has(eventType);
  if (kind === 'combat') return COMBAT_GROUP_TYPES.has(eventType);
  return false;
};

// Group consecutive envelopes that belong to the same movement or combat
// resolution (shared `ts` + `actor`). Events that don't fit the current
// batch kind get their own entry so per-turn lifecycle events (game
// created, phase change, turn advance, orders committed) still show as
// distinct replay steps.
const groupEnvelopesByBatch = (
  envelopes: EventEnvelope[],
): EventEnvelope[][] => {
  const batches: EventEnvelope[][] = [];
  let currentKind: BatchKind = null;

  for (const envelope of envelopes) {
    const last = batches[batches.length - 1];
    const eventType = envelope.event.type;
    const eventKind = classifyEvent(eventType);

    const canExtend =
      last !== undefined &&
      last[0].ts === envelope.ts &&
      last[0].actor === envelope.actor &&
      currentKind !== null &&
      (eventKind === currentKind || canExtendBatch(currentKind, eventType));

    if (canExtend && last) {
      last.push(envelope);
      continue;
    }

    batches.push([envelope]);
    currentKind = eventKind;
  }

  return batches;
};

const toReplayEntriesFromStream = (
  eventStream: EventEnvelope[],
  checkpoint: Checkpoint | null,
): ReplayEntry[] => {
  const hasFullHistory = eventStream.some(
    (envelope) => envelope.event.type === 'gameCreated',
  );
  const replayStream =
    checkpoint && !hasFullHistory
      ? eventStream.filter((envelope) => envelope.seq > checkpoint.seq)
      : eventStream;
  const useCheckpointFallback = checkpoint !== null && !hasFullHistory;
  const entries: ReplayEntry[] = useCheckpointFallback
    ? [toCheckpointReplayEntry(checkpoint)]
    : [];
  let currentState = useCheckpointFallback ? checkpoint.state : null;

  for (const batch of groupEnvelopesByBatch(replayStream)) {
    const projected = projectGameStateFromStream(batch, map, currentState);

    if (!projected.ok) {
      continue;
    }

    const nextState = projected.value;
    const previousSerialized =
      currentState === null ? null : JSON.stringify(currentState);
    const nextSerialized = JSON.stringify(nextState);

    const previousState = currentState;
    currentState = nextState;

    if (previousSerialized === nextSerialized) {
      continue;
    }

    const message = buildReplayMessageFromEvents(
      batch.map((envelope) => envelope.event),
      nextState,
      previousState,
      entries.length === 0,
    );

    entries.push(toReplayEntry(entries.length + 1, message, batch[0].ts));
  }

  return entries;
};

const createProjectedTimelineMetadata = (
  gameId: GameId,
  eventStream: EventEnvelope[],
  checkpoint: Checkpoint | null,
  createdAt: number | null,
): Pick<
  ReplayTimeline,
  'gameId' | 'roomCode' | 'matchNumber' | 'scenario' | 'createdAt'
> | null => {
  const parsed = parseMatchId(gameId);
  const gameCreated = eventStream.find(
    (envelope) => envelope.event.type === 'gameCreated',
  );
  const scenario =
    checkpoint?.state.scenario ??
    (gameCreated?.event.type === 'gameCreated'
      ? gameCreated.event.scenario
      : '');
  const replayCreatedAt =
    createdAt ?? gameCreated?.ts ?? checkpoint?.savedAt ?? 0;

  if (!parsed && !checkpoint && !gameCreated) {
    return null;
  }

  return {
    gameId,
    roomCode: parsed?.roomCode ?? '',
    matchNumber: parsed?.matchNumber ?? 0,
    scenario,
    createdAt: replayCreatedAt,
  };
};

export const projectReplayTimeline = (
  checkpoint: Checkpoint | null,
  eventStream: EventEnvelope[],
  viewerId: ViewerId,
  createdAt: number | null = null,
): ReplayTimeline | null => {
  const metadata = createProjectedTimelineMetadata(
    checkpoint?.gameId ?? eventStream[0]?.gameId ?? asGameId(''),
    eventStream,
    checkpoint,
    createdAt,
  );

  if (!metadata) {
    return null;
  }

  return filterReplayTimelineForViewer(
    {
      ...metadata,
      entries: toReplayEntriesFromStream(eventStream, checkpoint),
    },
    viewerId,
  );
};

// Strip fields that legitimately diverge between projected and live state:
// - connected / ready: session-level flags updated outside the engine
// - detected: visibility recomputed each tick from sensor data
// - firedThisPhase / combatTargetedThisPhase: UI/planning-only combat residue
export const normalizeStateForParity = (state: GameState): GameState => ({
  ...state,
  combatTargetedThisPhase: undefined,
  players: state.players.map((player) => ({
    ...player,
    connected: false,
    ready: false,
  })) as GameState['players'],
  ships: state.ships.map((ship) => ({
    ...ship,
    detected: false,
    firedThisPhase: undefined,
  })),
});

export interface ProjectionParityDiff {
  path: string;
  live: unknown;
  projected: unknown;
}

const collectParityDiffs = (
  live: unknown,
  projected: unknown,
  path = '',
): ProjectionParityDiff[] => {
  if (typeof live !== typeof projected) {
    return [{ path, live, projected }];
  }

  if (
    live === null ||
    projected === null ||
    typeof live !== 'object' ||
    typeof projected !== 'object'
  ) {
    return Object.is(live, projected) ? [] : [{ path, live, projected }];
  }

  if (Array.isArray(live) || Array.isArray(projected)) {
    if (!Array.isArray(live) || !Array.isArray(projected)) {
      return [{ path, live, projected }];
    }

    const diffs: ProjectionParityDiff[] = [];
    const length = Math.max(live.length, projected.length);

    for (let index = 0; index < length; index++) {
      diffs.push(
        ...collectParityDiffs(
          live[index],
          projected[index],
          `${path}[${index}]`,
        ),
      );
    }

    return diffs;
  }

  const liveRecord = live as Record<string, unknown>;
  const projectedRecord = projected as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(liveRecord),
    ...Object.keys(projectedRecord),
  ]);
  const diffs: ProjectionParityDiff[] = [];

  for (const key of [...keys].sort()) {
    diffs.push(
      ...collectParityDiffs(
        liveRecord[key],
        projectedRecord[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }

  return diffs;
};

export const getProjectionParityDiff = (
  projectedState: GameState | null,
  liveState: GameState,
): ProjectionParityDiff[] =>
  projectedState === null
    ? [
        {
          path: '',
          live: normalizeStateForParity(liveState),
          projected: null,
        },
      ]
    : collectParityDiffs(
        normalizeStateForParity(liveState),
        normalizeStateForParity(projectedState),
      );

export const hasProjectedStateParity = (
  projectedState: GameState | null,
  liveState: GameState,
): boolean => getProjectionParityDiff(projectedState, liveState).length === 0;
