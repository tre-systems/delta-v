import { describe, expect, it } from 'vitest';

import { SCENARIOS, type ScenarioKey } from '../../shared/map-data';
import {
  asymmetricBriefingScenarioKeysForTest,
  getScenarioBriefingCopy,
} from './scenario-briefing-copy';

describe('getScenarioBriefingCopy', () => {
  it('returns distinct seat copy for Convoy P0 (escort) and P1 (pirates)', () => {
    const a = getScenarioBriefingCopy('convoy', 0);
    const b = getScenarioBriefingCopy('convoy', 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // Convoy P0 is the escort: the briefing should mention escorting /
    // colonists / passengers.
    expect(a).toMatch(/escort|colonist|passenger/i);
    // Convoy P1 is the corsair side: the briefing should describe the
    // intercept / hunt mission.
    expect(b).toMatch(/hunt|intercept|destroy/i);
  });

  it('returns distinct seat copy for Lunar Evacuation', () => {
    const rescue = getScenarioBriefingCopy('evacuation', 0);
    const corsair = getScenarioBriefingCopy('evacuation', 1);
    expect(rescue).not.toBeNull();
    expect(corsair).not.toBeNull();
    expect(rescue).not.toBe(corsair);
    expect(rescue).toMatch(/evacuat|colonist|carrier|escort/i);
    expect(corsair).toMatch(/cut.*off|destroy|kill/i);
  });

  it('returns distinct seat copy for Escape', () => {
    const fugitives = getScenarioBriefingCopy('escape', 0);
    const enforcers = getScenarioBriefingCopy('escape', 1);
    expect(fugitives).not.toBeNull();
    expect(enforcers).not.toBeNull();
    expect(fugitives).not.toBe(enforcers);
    expect(fugitives).toMatch(/pilgrim|escape|hidden|north/i);
    expect(fugitives).toContain('★ ship');
    expect(fugitives).not.toMatch(/fly any ship/i);
    expect(enforcers).toMatch(/inspect|capture|destroy/i);
  });

  it('returns distinct seat copy for Blockade Runner', () => {
    const packet = getScenarioBriefingCopy('blockade', 0);
    const corvette = getScenarioBriefingCopy('blockade', 1);
    expect(packet).not.toBeNull();
    expect(corvette).not.toBeNull();
    expect(packet).not.toBe(corvette);
    expect(packet).toMatch(/packet|slip|land|head-start/i);
    expect(corvette).toMatch(/intercept|maneuver|cone|land/i);
  });

  it('returns null for symmetric scenarios so the shared description is used', () => {
    for (const sym of [
      'biplanetary',
      'duel',
      'grandTour',
      'fleetAction',
      'interplanetaryWar',
    ] as const) {
      expect(getScenarioBriefingCopy(sym, 0)).toBeNull();
      expect(getScenarioBriefingCopy(sym, 1)).toBeNull();
    }
  });

  it('every asymmetric briefing key resolves to a real published scenario', () => {
    for (const key of asymmetricBriefingScenarioKeysForTest()) {
      // SCENARIOS is the public map keyed by ScenarioKey — a typo in the
      // briefing-copy module would fall through to the shared
      // description without warning. This test catches that.
      expect(SCENARIOS[key as ScenarioKey]).toBeDefined();
    }
  });
});
