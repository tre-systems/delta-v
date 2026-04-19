import { describe, expect, it } from 'vitest';

import { validateUsername } from './username';

describe('validateUsername', () => {
  it('accepts a plain alphanumeric name', () => {
    expect(validateUsername('Zephyr')).toEqual({
      ok: true,
      normalised: 'Zephyr',
    });
  });

  it('accepts underscore, dash, and spaces', () => {
    expect(validateUsername('cool_agent-42')).toEqual({
      ok: true,
      normalised: 'cool_agent-42',
    });
    expect(validateUsername('Pilot 3BAA')).toEqual({
      ok: true,
      normalised: 'Pilot 3BAA',
    });
  });

  it('trims and collapses internal whitespace', () => {
    expect(validateUsername('  pilot   prime  ')).toEqual({
      ok: true,
      normalised: 'pilot prime',
    });
  });

  it('rejects non-strings', () => {
    expect(validateUsername(42)).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(validateUsername(null)).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(validateUsername(undefined)).toEqual({
      ok: false,
      error: 'invalid_format',
    });
  });

  it('rejects names that are too short', () => {
    expect(validateUsername('a')).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(validateUsername('')).toEqual({
      ok: false,
      error: 'invalid_format',
    });
  });

  it('rejects names that exceed the max length', () => {
    expect(validateUsername('a'.repeat(21))).toEqual({
      ok: false,
      error: 'invalid_format',
    });
  });

  it('rejects punctuation and unicode', () => {
    expect(validateUsername('exclaim!')).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(validateUsername('emoji😀here')).toEqual({
      ok: false,
      error: 'invalid_format',
    });
  });

  it('rejects substrings on the blocklist', () => {
    expect(validateUsername('retard_kitten')).toEqual({
      ok: false,
      error: 'blocked',
    });
  });

  it('rejects reserved operator-facing names', () => {
    expect(validateUsername('admin')).toEqual({
      ok: false,
      error: 'reserved',
    });
    expect(validateUsername('Delta-V')).toEqual({
      ok: false,
      error: 'reserved',
    });
    expect(validateUsername('test user')).toEqual({
      ok: false,
      error: 'reserved',
    });
  });

  it('is case-insensitive on the blocklist', () => {
    expect(validateUsername('RetArD')).toEqual({
      ok: false,
      error: 'blocked',
    });
  });
});
