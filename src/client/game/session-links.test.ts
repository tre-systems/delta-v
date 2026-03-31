import { describe, expect, it } from 'vitest';

import {
  buildGameRoute,
  buildJoinCheckUrl,
  buildWebSocketUrl,
} from './session-links';

describe('game client session links', () => {
  it('builds routes and websocket URLs with optional tokens', () => {
    expect(buildGameRoute('ABCDE')).toBe('/?code=ABCDE');

    expect(
      buildJoinCheckUrl(
        {
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        'player token',
      ),
    ).toBe('https://delta-v.example/join/ABCDE?playerToken=player+token');

    expect(
      buildJoinCheckUrl(
        {
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        null,
      ),
    ).toBe('https://delta-v.example/join/ABCDE');

    expect(
      buildWebSocketUrl(
        {
          protocol: 'https:',
          host: 'delta-v.example',
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        'player token',
      ),
    ).toBe('wss://delta-v.example/ws/ABCDE?playerToken=player%20token');

    expect(
      buildWebSocketUrl(
        {
          protocol: 'http:',
          host: 'localhost:8787',
          origin: 'http://localhost:8787',
        },
        'ABCDE',
        null,
      ),
    ).toBe('ws://localhost:8787/ws/ABCDE');

    expect(
      buildWebSocketUrl(
        {
          protocol: 'https:',
          host: 'delta-v.example',
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        'ignored-token',
        { viewer: 'spectator' },
      ),
    ).toBe('wss://delta-v.example/ws/ABCDE?viewer=spectator');
  });
});
