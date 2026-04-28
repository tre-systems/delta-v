import { getBodyOffset, getControlledBaseHexes } from './map-layout';
import type { ScenarioDefinition } from './types';

// Typed as a concrete object so we can derive ScenarioKey from its keys.
// satisfies ensures each value matches ScenarioDefinition without widening.
const SCENARIOS_INTERNAL = {
  biplanetary: {
    name: 'Bi-Planetary',
    tags: ['Beginner'],
    description: '1v1 corvettes race to land on the ' + "opponent's world",
    lobbyMeta: {
      beginnerFriendly: true,
      hook: 'Land on the enemy world first.',
      length: 'short',
      complexity: 'low',
      mechanics: ['1v1', 'Corvette start'],
    },
    players: [
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        bases: getControlledBaseHexes('Mars'),
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -7, r: 7 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Mars',
        homeBody: 'Venus',
        bases: getControlledBaseHexes('Venus'),
        escapeWins: false,
      },
    ],
  },

  escape: {
    name: 'Escape',
    tags: ['Asymmetric'],
    description:
      '3 pilgrim transports flee Terra ' + '— enforcers must stop them',
    lobbyMeta: {
      hook: 'Hide the pilgrims and break north.',
      length: 'medium',
      complexity: 'high',
      mechanics: ['Asymmetric', 'Hidden cargo', 'Escape edge'],
    },
    rules: {
      allowedOrdnanceTypes: ['nuke'],
      planetaryDefenseEnabled: false,
      hiddenIdentityInspection: true,
      escapeEdge: 'north',
    },
    players: [
      {
        ships: [
          {
            type: 'transport',
            position: getBodyOffset('Terra', -2, 1),
            velocity: { dq: -2, dr: 1 },
          },
          {
            type: 'transport',
            position: getBodyOffset('Terra', -2, 1),
            velocity: { dq: -2, dr: 1 },
          },
          {
            type: 'transport',
            position: getBodyOffset('Terra', -2, 1),
            velocity: { dq: -2, dr: 1 },
          },
        ],
        targetBody: '',
        homeBody: 'Terra',
        bases: [],
        escapeWins: true,
        hiddenIdentity: true,
      },
      {
        ships: [
          {
            type: 'corvette',
            position: getBodyOffset('Terra', -4, 2),
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
          {
            type: 'corsair',
            position: { q: -5, r: 5 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Venus',
        bases: getControlledBaseHexes('Terra', 'Venus', 'Io'),
        escapeWins: false,
      },
    ],
  },

  evacuation: {
    name: 'Lunar Evacuation',
    tags: ['Escort'],
    description:
      'A crowded transport flees Luna for Terra with corvette and frigate escorts ' +
      '— win only by landing survivors; a corsair tries to cut you off',
    lobbyMeta: {
      hook: 'Get survivors from Luna to Terra.',
      length: 'medium',
      complexity: 'high',
      mechanics: ['Escort', 'Passengers', 'Asymmetric'],
    },
    rules: {
      logisticsEnabled: true,
      passengerRescueEnabled: true,
      targetWinRequiresPassengers: true,
    },
    players: [
      {
        ships: [
          {
            type: 'transport',
            position: getBodyOffset('Luna', 0, -1),
            velocity: { dq: -2, dr: 1 },
            startLanded: false,
            initialPassengers: 40,
          },
          {
            type: 'corvette',
            position: getBodyOffset('Luna', 0, -1),
            velocity: { dq: -2, dr: 1 },
            startLanded: false,
          },
          {
            type: 'frigate',
            position: getBodyOffset('Luna', 1, -3),
            velocity: { dq: -1, dr: 1 },
            startLanded: false,
          },
        ],
        targetBody: 'Terra',
        homeBody: 'Luna',
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corsair',
            position: getBodyOffset('Terra', -2, -2),
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Terra',
        escapeWins: false,
      },
    ],
  },

  convoy: {
    name: 'Convoy',
    tags: ['Escort'],
    description:
      'Escort a liner with colonists (and tanker) from Mars to Venus ' +
      '— transfer passengers to safety; pirates intercept',
    lobbyMeta: {
      hook: 'Move colonists through pirate interceptors.',
      length: 'medium',
      complexity: 'high',
      mechanics: ['Escort', 'Passengers', 'Logistics'],
    },
    rules: {
      logisticsEnabled: true,
      passengerRescueEnabled: true,
      targetWinRequiresPassengers: true,
    },
    players: [
      {
        ships: [
          {
            type: 'liner',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
            initialPassengers: 120,
          },
          {
            type: 'tanker',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
          {
            type: 'frigate',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corsair',
            position: { q: -9, r: 2 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
          {
            type: 'corsair',
            position: { q: -6, r: -1 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
          {
            type: 'corvette',
            position: { q: -7, r: -3 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: '',
        escapeWins: false,
      },
    ],
  },

  duel: {
    name: 'Duel',
    tags: ['Combat'],
    description:
      'Frigates face off across Mercury ' +
      '— use gravity to outmaneuver your opponent',
    lobbyMeta: {
      hook: 'Outfly one frigate around Mercury.',
      length: 'short',
      complexity: 'medium',
      mechanics: ['1v1', 'Combat-heavy'],
    },
    rules: {
      planetaryDefenseEnabled: false,
      // Duel-only AI scoring: reduce combat-closing pressure so the AI
      // plays range-managed fights instead of rushing the first turn.
      // Measured in a 480-game seeded sweep to lift duel's average length
      // from ~6 to ~8 turns with seat balance intact; other scenarios are
      // unaffected because they don't set these overrides. Full weights
      // live in src/shared/ai/config.ts AI_CONFIG.hard.
      aiConfigOverrides: {
        combatClosingWeight: 0,
        combatCloseBonus: 0,
      },
    },
    startingPlayer: 1,
    players: [
      {
        ships: [
          {
            type: 'frigate',
            position: getBodyOffset('Mercury', 2, -3),
            velocity: { dq: -1, dr: 1 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [getBodyOffset('Mercury', 1, 0)],
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'frigate',
            position: getBodyOffset('Mercury', -2, 3),
            velocity: { dq: 1, dr: -1 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [getBodyOffset('Mercury', -1, 0)],
        escapeWins: false,
      },
    ],
  },

  blockade: {
    name: 'Blockade Runner',
    tags: ['Speed'],
    description: 'Packet ship races past a corvette ' + 'to reach Mars',
    lobbyMeta: {
      hook: 'Slip a packet ship through the screen.',
      length: 'short',
      complexity: 'medium',
      mechanics: ['Asymmetric', 'Landing race'],
    },
    startingPlayer: 1,
    players: [
      {
        ships: [
          {
            type: 'packet',
            position: { q: -7, r: 3 },
            velocity: { dq: 0, dr: -2 },
            startLanded: false,
          },
        ],
        targetBody: 'Mars',
        homeBody: 'Venus',
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -8, r: 1 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },

  interplanetaryWar: {
    name: 'Interplanetary War',
    tags: ['Epic'],
    description:
      'Build your fleet with MegaCredits ' +
      '— total war across the solar system',
    lobbyMeta: {
      hook: 'Build an empire-scale fleet war.',
      length: 'long',
      complexity: 'high',
      mechanics: ['Fleet build', 'Logistics', 'Campaign-scale'],
    },
    rules: { logisticsEnabled: true },
    startingPlayer: 1,
    startingCredits: 850,
    availableFleetPurchases: [
      'transport',
      'packet',
      'tanker',
      'corvette',
      'corsair',
      'frigate',
      'dreadnaught',
      'torch',
      'orbitalBaseCargo',
    ],
    players: [
      {
        ships: [],
        targetBody: '',
        homeBody: 'Terra',
        escapeWins: false,
      },
      {
        ships: [],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },

  fleetAction: {
    name: 'Fleet Action',
    tags: ['Fleet'],
    description: 'Build your fleet and clash ' + '— Mars vs Venus',
    lobbyMeta: {
      hook: 'Buy a battle line and force a decision.',
      length: 'long',
      complexity: 'high',
      mechanics: ['Fleet build', 'Combat-heavy'],
    },
    rules: {
      logisticsEnabled: true,
      aiConfigOverrides: {
        combatClosingWeight: 5,
        combatCloseBonus: 75,
      },
    },
    startingPlayer: 1,
    startingCredits: [600, 400],
    availableFleetPurchases: [
      'corvette',
      'corsair',
      'frigate',
      'dreadnaught',
      'torch',
    ],
    players: [
      {
        ships: [],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        ships: [],
        targetBody: '',
        homeBody: 'Venus',
        escapeWins: false,
      },
    ],
  },

  grandTour: {
    name: 'Grand Tour',
    tags: ['Race'],
    description:
      'Race past every major body in the solar ' + 'system and return home',
    lobbyMeta: {
      hook: 'Race every planet, then get home.',
      length: 'medium',
      complexity: 'medium',
      mechanics: ['No combat', 'Navigation race', 'Shared bases'],
    },
    rules: {
      combatDisabled: true,
      checkpointBodies: [
        'Sol',
        'Mercury',
        'Venus',
        'Terra',
        'Luna',
        'Mars',
        'Jupiter',
        'Io',
        'Callisto',
      ],
      randomizeStartingPlayer: true,
      sharedBases: ['Terra', 'Venus', 'Mars', 'Callisto'],
    },
    players: [
      {
        ships: [
          {
            type: 'corvette',
            position: getBodyOffset('Luna', 0, 0),
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: '',
        homeBody: 'Luna',
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },
} satisfies Record<string, ScenarioDefinition>;

// Union of all scenario keys, derived from the object above.
export type ScenarioKey = keyof typeof SCENARIOS_INTERNAL;

export const SCENARIO_DISPLAY_ORDER = [
  'biplanetary',
  'duel',
  'blockade',
  'grandTour',
  'escape',
  'evacuation',
  'convoy',
  'fleetAction',
  'interplanetaryWar',
] as const satisfies readonly ScenarioKey[];

// Runtime type guard for validating untrusted scenario strings.
export const isValidScenario = (key: string): key is ScenarioKey =>
  Object.hasOwn(SCENARIOS_INTERNAL, key);

// Public reference — typed with concrete keys so SCENARIOS.biplanetary etc. work,
// but also indexable with ScenarioKey.
export const SCENARIOS: { readonly [K in ScenarioKey]: ScenarioDefinition } =
  SCENARIOS_INTERNAL;
