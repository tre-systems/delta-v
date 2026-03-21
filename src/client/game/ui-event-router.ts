import type { UIEvent } from '../ui/events';
import type { GameCommand } from './commands';

export type UIEventPlan =
  | { kind: 'createGame'; scenario: string }
  | {
      kind: 'startSinglePlayer';
      scenario: string;
      difficulty: 'easy' | 'normal' | 'hard';
    }
  | { kind: 'joinGame'; code: string; playerToken: string | null }
  | { kind: 'command'; command: GameCommand }
  | { kind: 'sendChat'; text: string }
  | { kind: 'trackOnly'; event: 'scenario_browsed' };

export const resolveUIEventPlan = (event: UIEvent): UIEventPlan => {
  switch (event.type) {
    case 'selectScenario':
      return { kind: 'createGame', scenario: event.scenario };
    case 'startSinglePlayer':
      return {
        kind: 'startSinglePlayer',
        scenario: event.scenario,
        difficulty: event.difficulty,
      };
    case 'join':
      return {
        kind: 'joinGame',
        code: event.code,
        playerToken: event.playerToken ?? null,
      };
    case 'undo':
      return { kind: 'command', command: { type: 'undoBurn' } };
    case 'confirm':
      return { kind: 'command', command: { type: 'confirmOrders' } };
    case 'launchOrdnance':
      return {
        kind: 'command',
        command: {
          type: 'launchOrdnance',
          ordType: event.ordType,
        },
      };
    case 'emplaceBase':
      return { kind: 'command', command: { type: 'emplaceBase' } };
    case 'skipOrdnance':
      return { kind: 'command', command: { type: 'skipOrdnance' } };
    case 'attack':
      return { kind: 'command', command: { type: 'queueAttack' } };
    case 'fireAll':
      return { kind: 'command', command: { type: 'fireAllAttacks' } };
    case 'skipCombat':
      return { kind: 'command', command: { type: 'skipCombat' } };
    case 'skipLogistics':
      return { kind: 'command', command: { type: 'skipLogistics' } };
    case 'confirmTransfers':
      return { kind: 'command', command: { type: 'confirmTransfers' } };
    case 'fleetReady':
      return {
        kind: 'command',
        command: {
          type: 'fleetReady',
          purchases: event.purchases,
        },
      };
    case 'rematch':
      return { kind: 'command', command: { type: 'requestRematch' } };
    case 'exit':
      return { kind: 'command', command: { type: 'exitToMenu' } };
    case 'selectShip':
      return {
        kind: 'command',
        command: {
          type: 'selectShip',
          shipId: event.shipId,
        },
      };
    case 'chat':
      return { kind: 'sendChat', text: event.text };
    case 'backToMenu':
      return { kind: 'trackOnly', event: 'scenario_browsed' };
  }
};
