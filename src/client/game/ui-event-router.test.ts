import { describe, expect, it } from 'vitest';

import { resolveUIEventPlan } from './ui-event-router';

describe('game-client-ui-event-router', () => {
  it('routes menu events to lifecycle plans', () => {
    expect(
      resolveUIEventPlan({
        type: 'selectScenario',
        scenario: 'duel',
      }),
    ).toEqual({
      kind: 'createGame',
      scenario: 'duel',
    });

    expect(
      resolveUIEventPlan({
        type: 'startSinglePlayer',
        scenario: 'escape',
        difficulty: 'hard',
      }),
    ).toEqual({
      kind: 'startSinglePlayer',
      scenario: 'escape',
      difficulty: 'hard',
    });

    expect(
      resolveUIEventPlan({
        type: 'join',
        code: 'ABCDE',
        playerToken: 'token',
      }),
    ).toEqual({
      kind: 'joinGame',
      code: 'ABCDE',
      playerToken: 'token',
    });
  });

  it('routes in-game events to commands, chat, and tracking', () => {
    expect(
      resolveUIEventPlan({
        type: 'launchOrdnance',
        ordType: 'torpedo',
      }),
    ).toEqual({
      kind: 'command',
      command: {
        type: 'launchOrdnance',
        ordType: 'torpedo',
      },
    });

    expect(
      resolveUIEventPlan({
        type: 'fleetReady',
        purchases: [{ kind: 'ship', shipType: 'frigate' }],
      }),
    ).toEqual({
      kind: 'command',
      command: {
        type: 'fleetReady',
        purchases: [{ kind: 'ship', shipType: 'frigate' }],
      },
    });

    expect(
      resolveUIEventPlan({
        type: 'chat',
        text: 'hello',
      }),
    ).toEqual({
      kind: 'sendChat',
      text: 'hello',
    });

    expect(resolveUIEventPlan({ type: 'skipOrdnanceShip' })).toEqual({
      kind: 'command',
      command: { type: 'skipOrdnanceShip' },
    });

    expect(resolveUIEventPlan({ type: 'confirmOrdnance' })).toEqual({
      kind: 'command',
      command: { type: 'confirmOrdnance' },
    });

    expect(resolveUIEventPlan({ type: 'attack' })).toEqual({
      kind: 'command',
      command: { type: 'confirmSingleAttack' },
    });

    expect(resolveUIEventPlan({ type: 'fireAll' })).toEqual({
      kind: 'command',
      command: { type: 'fireAllAttacks' },
    });

    expect(resolveUIEventPlan({ type: 'skipCombat' })).toEqual({
      kind: 'command',
      command: { type: 'endCombat' },
    });

    expect(resolveUIEventPlan({ type: 'backToMenu' })).toEqual({
      kind: 'trackOnly',
      event: 'scenario_browsed',
    });
  });

  it('routes replay controls to replay plans', () => {
    expect(resolveUIEventPlan({ type: 'replayMatchPrev' })).toEqual({
      kind: 'selectReplayMatch',
      direction: 'prev',
    });
    expect(resolveUIEventPlan({ type: 'replayMatchNext' })).toEqual({
      kind: 'selectReplayMatch',
      direction: 'next',
    });
    expect(resolveUIEventPlan({ type: 'toggleReplay' })).toEqual({
      kind: 'toggleReplay',
    });
    expect(resolveUIEventPlan({ type: 'replayEnd' })).toEqual({
      kind: 'replayNav',
      direction: 'end',
    });
  });
});
