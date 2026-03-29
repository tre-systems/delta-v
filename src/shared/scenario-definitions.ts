import { getBodyOffset, getControlledBaseHexes } from './map-layout';
import type { ScenarioDefinition } from './types';

export const SCENARIOS: Record<string, ScenarioDefinition> = {
  biplanetary: {
    name: 'Bi-Planetary',
    tags: ['Beginner'],
    description: '1v1 corvettes race to land on the ' + "opponent's world",
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
            position: getBodyOffset('Terra', -2, 1),
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
      'A crowded transport flees Luna for Terra with a corvette escort ' +
      '— win only by landing survivors; a corsair tries to cut you off',
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
            position: getBodyOffset('Luna', -1, 0),
            velocity: { dq: -2, dr: 1 },
            startLanded: false,
            initialPassengers: 40,
          },
          {
            type: 'corvette',
            position: getBodyOffset('Luna', -1, 0),
            velocity: { dq: -2, dr: 1 },
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
            position: getBodyOffset('Terra', 1, -1),
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
    description: 'Frigates clash near Mercury ' + '— last ship standing wins',
    startingPlayer: 1,
    players: [
      {
        ships: [
          {
            type: 'frigate',
            position: getBodyOffset('Mercury', -1, -1),
            velocity: { dq: 0, dr: 0 },
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
            position: getBodyOffset('Mercury', 1, 1),
            velocity: { dq: 0, dr: 0 },
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
    rules: { logisticsEnabled: true },
    startingPlayer: 1,
    startingCredits: 400,
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
    rules: {
      combatDisabled: true,
      checkpointBodies: [
        'Sol',
        'Mercury',
        'Venus',
        'Terra',
        'Mars',
        'Jupiter',
        'Io',
        'Callisto',
      ],
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
};
