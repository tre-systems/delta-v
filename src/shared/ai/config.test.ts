import { describe, expect, it } from 'vitest';
import { AI_CONFIG, resolveAIConfig } from './config';

describe('resolveAIConfig', () => {
  it('returns the base difficulty config when no overrides are given', () => {
    // Sanity check — with no overrides we must get the raw AI_CONFIG entry
    // back so production call sites that don't thread scenarioRules still
    // observe unchanged behaviour.
    const hard = resolveAIConfig('hard');
    expect(hard).toEqual(AI_CONFIG.hard);

    const easy = resolveAIConfig('easy', undefined);
    expect(easy).toEqual(AI_CONFIG.easy);
  });

  it('applies scenario overrides only to the listed fields', () => {
    // Duel uses this to reduce combat-closing pressure. We assert both
    // that the override fields change AND that every other knob keeps
    // its difficulty-level default so no unrelated behaviour drifts.
    const merged = resolveAIConfig('hard', {
      combatClosingWeight: 1,
      combatCloseBonus: 10,
    });

    expect(merged.combatClosingWeight).toBe(1);
    expect(merged.combatCloseBonus).toBe(10);
    expect(merged.multiplier).toBe(AI_CONFIG.hard.multiplier);
    expect(merged.navDistWeight).toBe(AI_CONFIG.hard.navDistWeight);
    expect(merged.torpedoRange).toBe(AI_CONFIG.hard.torpedoRange);
    expect(merged.minRollThreshold).toBe(AI_CONFIG.hard.minRollThreshold);
  });

  it('does not mutate the underlying AI_CONFIG entry', () => {
    // The merged result must be a fresh object; modifying it or
    // holding a reference must not leak into the shared config.
    const before = AI_CONFIG.hard.combatClosingWeight;
    resolveAIConfig('hard', { combatClosingWeight: 99 });
    expect(AI_CONFIG.hard.combatClosingWeight).toBe(before);
  });

  it('keeps normal materially less decisive than hard on core combat knobs', () => {
    expect(AI_CONFIG.normal.combatClosingWeight).toBeLessThan(
      AI_CONFIG.hard.combatClosingWeight,
    );
    expect(AI_CONFIG.normal.combatCloseBonus).toBeLessThan(
      AI_CONFIG.hard.combatCloseBonus,
    );
    expect(AI_CONFIG.normal.torpedoRange).toBeLessThan(
      AI_CONFIG.hard.torpedoRange,
    );
    expect(AI_CONFIG.normal.minRollThreshold).toBeGreaterThan(
      AI_CONFIG.hard.minRollThreshold,
    );
  });
});
