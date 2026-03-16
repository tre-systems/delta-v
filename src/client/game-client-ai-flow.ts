import { aiAstrogation, aiCombat, aiOrdnance, type AIDifficulty } from '../shared/ai';
import { SHIP_STATS } from '../shared/constants';
import { filterStateForPlayer } from '../shared/game-engine';
import type {
  AstrogationOrder,
  CombatAttack,
  GameState,
  OrdnanceLaunch,
  SolarSystemMap,
} from '../shared/types';
import { hasOwnedPendingAsteroidHazards } from './game-client-local';

export interface AIDecisionGenerators {
  astrogation: typeof aiAstrogation;
  ordnance: typeof aiOrdnance;
  combat: typeof aiCombat;
}

export type AIActionPlan =
  | { kind: 'none' }
  | {
      kind: 'astrogation';
      aiPlayer: number;
      orders: AstrogationOrder[];
      errorPrefix: 'AI astrogation error:';
    }
  | {
      kind: 'ordnance';
      aiPlayer: number;
      launches: OrdnanceLaunch[];
      logEntries: string[];
      skip: boolean;
      errorPrefix: 'AI ordnance error:' | 'AI skip ordnance error:';
    }
  | {
      kind: 'beginCombat';
      aiPlayer: number;
      errorPrefix: 'AI combat start error:';
    }
  | {
      kind: 'combat';
      aiPlayer: number;
      attacks: CombatAttack[];
      skip: boolean;
      errorPrefix: 'AI combat error:' | 'AI skip combat error:';
    }
  | {
      kind: 'transition';
      aiPlayer: number;
    };

function buildAIOrdnanceLogEntries(state: GameState, launches: OrdnanceLaunch[]): string[] {
  return launches.map((launch) => {
    const ship = state.ships.find((candidate) => candidate.id === launch.shipId);
    const name = ship ? (SHIP_STATS[ship.type]?.name ?? ship.type) : launch.shipId;
    return `AI: ${name} launched ${launch.ordnanceType}`;
  });
}

export function deriveAIActionPlan(
  state: GameState | null,
  playerId: number,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  generators: AIDecisionGenerators = {
    astrogation: aiAstrogation,
    ordnance: aiOrdnance,
    combat: aiCombat,
  },
): AIActionPlan {
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
      orders: generators.astrogation(filterStateForPlayer(state, aiPlayer), aiPlayer, map, difficulty),
      errorPrefix: 'AI astrogation error:',
    };
  }

  if (state.phase === 'ordnance') {
    const launches = generators.ordnance(filterStateForPlayer(state, aiPlayer), aiPlayer, map, difficulty);
    return {
      kind: 'ordnance',
      aiPlayer,
      launches,
      logEntries: buildAIOrdnanceLogEntries(state, launches),
      skip: launches.length === 0,
      errorPrefix: launches.length > 0 ? 'AI ordnance error:' : 'AI skip ordnance error:',
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

    const attacks = generators.combat(filterStateForPlayer(state, aiPlayer), aiPlayer, map, difficulty);
    return {
      kind: 'combat',
      aiPlayer,
      attacks,
      skip: attacks.length === 0,
      errorPrefix: attacks.length > 0 ? 'AI combat error:' : 'AI skip combat error:',
    };
  }

  return {
    kind: 'transition',
    aiPlayer,
  };
}
