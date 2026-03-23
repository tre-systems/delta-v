import { describe, expect, it } from 'vitest';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { EventEnvelope } from './engine-events';
import { projectMatchSetupFromStream } from './event-projector';
import { processFleetReady } from './fleet-building';
import { createGame } from './game-creation';

const map = buildSolarSystemMap();

describe('projectMatchSetupFromStream', () => {
  it('rebuilds fleet-building setup from setup events', () => {
    const purchases0 = [{ shipType: 'corvette' }, { shipType: 'corsair' }];
    const purchases1 = [{ shipType: 'frigate' }];
    const events: EventEnvelope[] = [
      {
        gameId: 'WAR01-m1',
        seq: 1,
        ts: 1,
        actor: null,
        event: {
          type: 'gameCreated',
          scenario: 'Interplanetary War',
          turn: 1,
          phase: 'fleetBuilding',
        },
      },
      {
        gameId: 'WAR01-m1',
        seq: 2,
        ts: 2,
        actor: 0,
        event: {
          type: 'fleetPurchased',
          playerId: 0,
          purchases: purchases0,
          shipTypes: purchases0.map((purchase) => purchase.shipType),
        },
      },
      {
        gameId: 'WAR01-m1',
        seq: 3,
        ts: 3,
        actor: 1,
        event: {
          type: 'fleetPurchased',
          playerId: 1,
          purchases: purchases1,
          shipTypes: purchases1.map((purchase) => purchase.shipType),
        },
      },
    ];

    const created = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01-m1',
      findBaseHex,
      () => 0,
    );
    const player0Ready = processFleetReady(
      created,
      0,
      purchases0,
      map,
      SCENARIOS.interplanetaryWar.availableShipTypes,
    );

    if ('error' in player0Ready) {
      throw new Error(player0Ready.error);
    }

    const expected = processFleetReady(
      player0Ready.state,
      1,
      purchases1,
      map,
      SCENARIOS.interplanetaryWar.availableShipTypes,
    );

    if ('error' in expected) {
      throw new Error(expected.error);
    }

    const projected = projectMatchSetupFromStream(events, map);

    expect(projected).toEqual({
      ok: true,
      state: expected.state,
    });
  });

  it('rebuilds deterministic fugitive designation from the stream', () => {
    const events: EventEnvelope[] = [
      {
        gameId: 'ESCAP-m1',
        seq: 1,
        ts: 1,
        actor: null,
        event: {
          type: 'gameCreated',
          scenario: 'Escape',
          turn: 1,
          phase: 'astrogation',
        },
      },
      {
        gameId: 'ESCAP-m1',
        seq: 2,
        ts: 2,
        actor: null,
        event: {
          type: 'fugitiveDesignated',
          shipId: 'p0s0',
          playerId: 0,
        },
      },
    ];

    const projected = projectMatchSetupFromStream(events, map);

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    const fugitiveShips = projected.state.ships.filter(
      (ship) => ship.owner === 0 && ship.identity?.hasFugitives,
    );

    expect(fugitiveShips).toHaveLength(1);
    expect(fugitiveShips[0]?.id).toBe('p0s0');
  });

  it('fails explicitly on unsupported non-setup events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'WAR01-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Interplanetary War',
            turn: 1,
            phase: 'fleetBuilding',
          },
        },
        {
          gameId: 'WAR01-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'shipMoved',
            shipId: 'p0s0',
            from: { q: 0, r: 0 },
            to: { q: 1, r: 0 },
            fuelSpent: 1,
            newVelocity: { dq: 1, dr: 0 },
          },
        },
      ],
      map,
    );

    expect(projected).toEqual({
      ok: false,
      error: 'unsupported setup event: shipMoved',
    });
  });

  it('applies turn and phase metadata events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'WAR01-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Interplanetary War',
            turn: 1,
            phase: 'fleetBuilding',
          },
        },
        {
          gameId: 'WAR01-m1',
          seq: 2,
          ts: 2,
          actor: 1,
          event: {
            type: 'turnAdvanced',
            turn: 2,
            activePlayer: 1,
          },
        },
        {
          gameId: 'WAR01-m1',
          seq: 3,
          ts: 3,
          actor: 1,
          event: {
            type: 'phaseChanged',
            phase: 'combat',
            turn: 2,
            activePlayer: 1,
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.state.turnNumber).toBe(2);
    expect(projected.state.activePlayer).toBe(1);
    expect(projected.state.phase).toBe('combat');
  });
});
