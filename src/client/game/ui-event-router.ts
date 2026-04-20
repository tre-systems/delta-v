import type { AIDifficulty } from '../../shared/ai/types';
import type { UIEvent } from '../ui/events';
import type { GameCommand } from './commands';

export type UIEventPlan =
  | { kind: 'quickMatch' }
  | { kind: 'cancelQuickMatch' }
  | { kind: 'createGame'; scenario: string }
  | {
      kind: 'startSinglePlayer';
      scenario: string;
      difficulty: AIDifficulty;
    }
  | { kind: 'joinGame'; code: string; playerToken: string | null }
  | { kind: 'command'; command: GameCommand }
  | { kind: 'selectReplayMatch'; direction: 'prev' | 'next' }
  | { kind: 'toggleReplay' }
  | { kind: 'replayPlayPause' }
  | { kind: 'replayNav'; direction: 'start' | 'prev' | 'next' | 'end' }
  | { kind: 'replayCycleSpeed' }
  | { kind: 'sendChat'; text: string }
  | { kind: 'trackOnly'; event: 'scenario_browsed' };

export const resolveUIEventPlan = (event: UIEvent): UIEventPlan => {
  switch (event.type) {
    case 'quickMatch':
      return { kind: 'quickMatch' };
    case 'cancelQuickMatch':
      return { kind: 'cancelQuickMatch' };
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
    case 'skipShip':
      return { kind: 'command', command: { type: 'skipShipBurn' } };
    case 'confirm':
      return { kind: 'command', command: { type: 'confirmOrders' } };
    case 'landFromOrbit':
      return { kind: 'command', command: { type: 'landFromOrbit' } };
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
    case 'skipOrdnanceShip':
      return { kind: 'command', command: { type: 'skipOrdnanceShip' } };
    case 'confirmOrdnance':
      return { kind: 'command', command: { type: 'confirmOrdnance' } };
    case 'attack':
      return { kind: 'command', command: { type: 'confirmSingleAttack' } };
    case 'fireAll':
      return { kind: 'command', command: { type: 'fireAllAttacks' } };
    case 'skipCombat':
      return { kind: 'command', command: { type: 'endCombat' } };
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
    case 'replayMatchPrev':
      return { kind: 'selectReplayMatch', direction: 'prev' };
    case 'replayMatchNext':
      return { kind: 'selectReplayMatch', direction: 'next' };
    case 'toggleReplay':
      return { kind: 'toggleReplay' };
    case 'replayPlayPause':
      return { kind: 'replayPlayPause' };
    case 'replayStart':
      return { kind: 'replayNav', direction: 'start' };
    case 'replayPrev':
      return { kind: 'replayNav', direction: 'prev' };
    case 'replayNext':
      return { kind: 'replayNav', direction: 'next' };
    case 'replayEnd':
      return { kind: 'replayNav', direction: 'end' };
    case 'replayCycleSpeed':
      return { kind: 'replayCycleSpeed' };
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
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};
