import { describe, expect, it } from 'vitest';

import { readBoundedJson } from './request-body';

describe('readBoundedJson', () => {
  it('parses a JSON body within the byte limit', async () => {
    const result = await readBoundedJson<{ ok: boolean }>(
      new Request('https://delta-v.test/', {
        method: 'POST',
        body: JSON.stringify({ ok: true }),
      }),
      64,
    );
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('rejects declared and streamed oversized bodies', async () => {
    const declared = await readBoundedJson(
      new Request('https://delta-v.test/', {
        method: 'POST',
        headers: { 'Content-Length': '1000' },
        body: '{}',
      }),
      16,
    );
    expect(declared).toEqual({ ok: false, reason: 'body_too_large' });

    const streamed = await readBoundedJson(
      new Request('https://delta-v.test/', {
        method: 'POST',
        body: JSON.stringify({ padding: 'x'.repeat(64) }),
      }),
      16,
    );
    expect(streamed).toEqual({ ok: false, reason: 'body_too_large' });
  });

  it('rejects malformed JSON and invalid UTF-8', async () => {
    expect(
      await readBoundedJson(
        new Request('https://delta-v.test/', {
          method: 'POST',
          body: 'not json',
        }),
        64,
      ),
    ).toEqual({ ok: false, reason: 'invalid_json' });

    expect(
      await readBoundedJson(
        new Request('https://delta-v.test/', {
          method: 'POST',
          body: new Uint8Array([0xff]),
        }),
        64,
      ),
    ).toEqual({ ok: false, reason: 'invalid_json' });
  });
});
