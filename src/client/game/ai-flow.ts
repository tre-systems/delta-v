import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
} from '../../shared/ai';
import { SHIP_STATS } from '../../shared/constants';
import { filterStateForPlayer } from '../../shared/engine/game-engine';
import type {
  AstrogationOrder,
  CombatAttack,
  GameState,
  OrdnanceLaunch,
  PlayerId,
  SolarSystemMap,
  TransferOrder,
} from '../../shared/types/domain';
import { hasOwnedPendingAsteroidHazards } from './local';

export interface AIDecisionGenerators {
  astrogation: typeof aiAstrogation;
  ordnance: typeof aiOrdnance;
  logistics: typeof aiLogistics;
  combat: typeof aiCombat;
}

export type AIActionPlan =
  | { kind: 'none' }
  | {
      kind: 'astrogation';
      aiPlayer: PlayerId;
      orders: AstrogationOrder[];
      errorPrefix: 'AI astrogation error:';
    }
  | {
      kind: 'ordnance';
      aiPlayer: PlayerId;
      launches: OrdnanceLaunch[];
      logEntries: string[];
      skip: boolean;
      errorPrefix: 'AI ordnance error:' | 'AI skip ordnance error:';
    }
  | {
      kind: 'beginCombat';
      aiPlayer: PlayerId;
      errorPrefix: 'AI combat start error:';
    }
  | {
      kind: 'combat';
      aiPlayer: PlayerId;
      attacks: CombatAttack[];
      skip: boolean;
      errorPrefix: 'AI combat error:' | 'AI skip combat error:';
    }
  | {
      kind: 'logistics';
      aiPlayer: PlayerId;
      transfers: TransferOrder[];
      skip: boolean;
      errorPrefix: 'AI logistics error:' | 'AI skip logistics error:';
    }
  | {
      kind: 'transition';
      aiPlayer: PlayerId;
    };

const buildAIOrdnanceLogEntries = (
  state: GameState,
  launches: OrdnanceLaunch[],
): string[] => {
  return launches.map((launch) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === launch.shipId,
    );
    const name = ship
      ? (SHIP_STATS[ship.type]?.name ?? ship.type)
      : launch.shipId;
    return `AI: ${name} launched ${launch.ordnanceType}`;
  });
};

export const deriveAIActionPlan = (
  state: GameState | null,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  generators: AIDecisionGenerators = {
    astrogation: aiAstrogation,
    ordnance: aiOrdnance,
    logistics: aiLogistics,
    combat: aiCombat,
  },
): AIActionPlan => {
  if (!state || state.phase === 'gameOver') {
    return { kind: 'none' };
  }

  const aiPlayer = state.activePlayer;

  if (aiPlayer === playerId) {
    return { kind: 'none' };
  }

  if (state.phase === 'astrogation') {
    return {
      kind: 'astrogation',
      aiPlayer,
      orders: generators.astrogation(
        filterStateForPlayer(state, aiPlayer),
        aiPlayer,
        map,
        difficulty,
      ),
      errorPrefix: 'AI astrogation error:',
    };
  }

  if (state.phase === 'ordnance') {
    const launches = generators.ordnance(
      filterStateForPlayer(state, aiPlayer),
      aiPlayer,
      map,
      difficulty,
    );
    return {
      kind: 'ordnance',
      aiPlayer,
      launches,
      logEntries: buildAIOrdnanceLogEntries(state, launches),
      skip: launches.length === 0,
      errorPrefix:
        launches.length > 0 ? 'AI ordnance error:' : 'AI skip ordnance error:',
    };
  }

  if (state.phase === 'logistics') {
    const transfers = generators.logistics(
      filterStateForPlayer(state, aiPlayer),
      aiPlayer,
      map,
      difficulty,
    );
    return {
      kind: 'logistics',
      aiPlayer,
      transfers,
      skip: transfers.length === 0,
      errorPrefix:
        transfers.length > 0
          ? 'AI logistics error:'
          : 'AI skip logistics error:',
    };
  }

  if (state.phase === 'combat') {
    if (hasOwnedPendingAsteroidHazards(state, aiPlayer)) {
      return {
        kind: 'beginCombat',
        aiPlayer,
        errorPrefix: 'AI combat start error:',
      };
    }

    const attacks = generators.combat(
      filterStateForPlayer(state, aiPlayer),
      aiPlayer,
      map,
      difficulty,
    );
    return {
      kind: 'combat',
      aiPlayer,
      attacks,
      skip: attacks.length === 0,
      errorPrefix:
        attacks.length > 0 ? 'AI combat error:' : 'AI skip combat error:',
    };
  }

  return {
    kind: 'transition',
    aiPlayer,
  };
};
