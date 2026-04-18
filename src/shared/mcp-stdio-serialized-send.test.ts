import { describe, expect, it } from 'vitest';

import { patchTransportWithSerializedSends } from './mcp-stdio-serialized-send';

describe('patchTransportWithSerializedSends', () => {
  it('never runs two sends overlapping in time', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const transport = {
      async send(_message: unknown) {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((r) => setTimeout(r, 3));
        inFlight -= 1;
      },
    };

    patchTransportWithSerializedSends(transport);

    await Promise.all([
      transport.send({ id: 'a' }),
      transport.send({ id: 'b' }),
      transport.send({ id: 'c' }),
    ]);

    expect(maxConcurrent).toBe(1);
  });

  it('preserves send order under concurrency', async () => {
    const order: number[] = [];
    const transport = {
      async send(message: unknown) {
        order.push((message as { n: number }).n);
      },
    };
    patchTransportWithSerializedSends(transport);

    await Promise.all([
      transport.send({ n: 1 }),
      transport.send({ n: 2 }),
      transport.send({ n: 3 }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});
