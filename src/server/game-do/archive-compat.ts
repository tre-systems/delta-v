import { migrateGameState } from '../../shared/engine/event-projector/support';
import type { GameId } from '../../shared/ids';
import type { GameState } from '../../shared/types/domain';
import { migrateLegacyEventStreamIfNeeded } from './archive-storage';

type Storage = DurableObjectStorage;

export const normalizeArchivedGameState = (state: GameState): GameState =>
  migrateGameState(state);

export const normalizeArchivedStateRecord = <T extends { state: GameState }>(
  record: T | null,
): T | null =>
  record
    ? {
        ...record,
        state: normalizeArchivedGameState(record.state),
      }
    : null;

export const ensureArchiveStreamCompatibility = async (
  storage: Storage,
  gameId: GameId,
): Promise<void> => {
  await migrateLegacyEventStreamIfNeeded(storage, gameId);
};
