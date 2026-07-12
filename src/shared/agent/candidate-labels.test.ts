import { describe, expect, it } from 'vitest';

import { asShipId } from '../ids';
import {
  createTestShip,
  createTestState,
  EMPTY_SOLAR_MAP,
} from '../test-helpers';
import { labelCandidate } from './candidate-labels';

describe('agent candidate labels', () => {
  it('warns when burns and pending gravity combine to leave a ship stationary', () => {
    const ship = createTestShip({
      id: asShipId('gravity-stop'),
      velocity: { dq: 2, dr: -3 },
      pendingGravityEffects: [
        {
          hex: { q: 3, r: 1 },
          direction: 3,
          bodyName: 'Mercury',
          strength: 'full',
          ignored: false,
        },
        {
          hex: { q: 3, r: 1 },
          direction: 4,
          bodyName: 'Mercury',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const state = createTestState({ ships: [ship] });

    const labeled = labelCandidate(
      {
        type: 'astrogation',
        orders: [{ shipId: ship.id, burn: 5, overload: 5, land: false }],
      },
      0,
      state,
      0,
      EMPTY_SOLAR_MAP,
    );

    expect(labeled.reasoning).toContain('STATIONARY WARNING');
    expect(labeled.reasoning).toContain('burns and gravity resolve');
  });
});
