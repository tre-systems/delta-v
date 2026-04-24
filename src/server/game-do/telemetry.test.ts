import { describe, expect, it } from 'vitest';

import { sanitizeEngineErrorField } from './telemetry';

describe('sanitizeEngineErrorField', () => {
  it('preserves short diagnostic fields', () => {
    expect(sanitizeEngineErrorField('short message')).toBe('short message');
  });

  it('truncates long diagnostic fields before D1 persistence', () => {
    const result = sanitizeEngineErrorField('x'.repeat(1500));

    expect(result).toHaveLength(1027);
    expect(result?.endsWith('...')).toBe(true);
  });

  it('omits nullish diagnostic fields', () => {
    expect(sanitizeEngineErrorField(undefined)).toBeUndefined();
    expect(sanitizeEngineErrorField(null)).toBeUndefined();
  });
});
