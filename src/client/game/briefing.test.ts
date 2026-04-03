import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { deriveScenarioBriefingEntries } from './briefing';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'transport',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createPlayers = (): [PlayerState, PlayerState] => [
  {
    connected: true,
    ready: true,
    targetBody: 'Venus',
    homeBody: 'Terra',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: 'Terra',
    homeBody: 'Mars',
    bases: [],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'BRIEF',
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip({ id: 'transport', type: 'transport' }),
    createShip({
      id: 'packet',
      type: 'packet',
      position: { q: 1, r: 0 },
    }),
    createShip({
      id: 'enemy',
      owner: 1,
      originalOwner: 0,
      type: 'corsair',
      position: { q: 2, r: 0 },
    }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  outcome: null,
  ...overrides,
});

describe('game-client-briefing', () => {
  it('includes fleet for standard landing scenarios', () => {
    expect(deriveScenarioBriefingEntries(createState(), 0)).toEqual([
      { text: 'Your fleet: Transport, Packet', cssClass: '' },
    ]);
  });

  it('classifies escape and hidden-identity briefing lines', () => {
    expect(
      deriveScenarioBriefingEntries(
        createState({
          ships: [
            createShip({
              identity: { hasFugitives: true, revealed: false },
            }),
            createShip({ id: 'enemy', owner: 1 }),
          ],
        }),
        0,
      ),
    ).toEqual([
      { text: 'Your fleet: Transport', cssClass: '' },
      {
        text: 'Your \u2605 ship carries the fugitives',
        cssClass: '',
      },
    ]);

    expect(
      deriveScenarioBriefingEntries(
        createState({
          scenarioRules: { hiddenIdentityInspection: true },
          players: [
            { ...createPlayers()[0], targetBody: '' },
            createPlayers()[1],
          ],
        }),
        0,
      ),
    ).toEqual([
      { text: 'Your fleet: Transport, Packet', cssClass: '' },
      {
        text: 'Inspect transports to find the fugitives',
        cssClass: '',
      },
    ]);
  });

  it('notes race-only for checkpoint scenarios', () => {
    expect(
      deriveScenarioBriefingEntries(
        createState({
          scenarioRules: {
            checkpointBodies: ['Mars', 'Venus', 'Jupiter'],
          },
        }),
        0,
      ),
    ).toEqual([
      { text: 'Your fleet: Transport, Packet', cssClass: '' },
      { text: 'No combat \u2014 race only', cssClass: '' },
    ]);
  });
});
