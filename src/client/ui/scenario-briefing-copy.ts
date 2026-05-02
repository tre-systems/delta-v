// Per-seat scenario briefing copy for asymmetric scenarios.
//
// `scenarioDefinitions.description` is fixed per scenario, so without a
// per-seat override the corsair / pirate / interceptor seats see a
// briefing that describes the *escort* mission. The 2026-05-02 live
// pass surfaced this as a recurring UX gap — Convoy P1 read "Escort a
// liner with colonists from Mars to Venus" while their objective was
// "Destroy all enemies".
//
// This module returns the per-seat description for the four asymmetric
// scenarios where the seats fly different missions (convoy, lunar
// evacuation, escape, blockade runner). Symmetric scenarios — Bi-
// Planetary, Duel, Grand Tour, Fleet Action, Interplanetary War — keep
// using the shared `scenario.description` and need no override here.

import type { ScenarioKey } from '../../shared/map-data';
import type { PlayerId } from '../../shared/types/domain';

interface AsymmetricBriefing {
  // 0-indexed by `PlayerId`. Each entry is the seat's first-person
  // mission narration; objective + role title appear separately in the
  // briefing so the description can stay one paragraph.
  readonly seats: readonly [string, string];
}

const BRIEFING_BY_SCENARIO: Partial<Record<ScenarioKey, AsymmetricBriefing>> = {
  convoy: {
    seats: [
      "Escort the colonist liner and tanker from Mars to Venus. Land a ship carrying passengers to win — the pirates will hunt the liner the moment it leaves Mars's gravity well.",
      'Hunt the colonist convoy as it tries to break out of Mars for Venus. Destroy the liner before any colonists reach safety; the escort frigate is the only thing standing in your way.',
    ],
  },
  evacuation: {
    seats: [
      'Evacuate survivors from Luna to Terra. The transport carries the colonists; corvette and frigate escorts must keep it alive long enough to land. The carrier is everything — lose it and the mission fails.',
      'A crowded transport is fleeing Luna for Terra. Cut it off — destroy the carrier or kill every colonist aboard before any reach Terra.',
    ],
  },
  escape: {
    seats: [
      'Three pilgrim transports are breaking out of Terra. One carries the fugitives — keep them hidden in the formation and fly any ship off the north map edge to escape.',
      'Three transports are trying to flee Terra. One carries the fugitives. Inspect, capture, or destroy them before any escape off the map edge.',
    ],
  },
  blockade: {
    seats: [
      'Slip the packet ship past the corvette and land it on Mars. You start with a head-start velocity — keep your speed up rather than fight; a corvette will outgun the packet in a straight exchange.',
      'A packet ship is trying to break through to Mars. Intercept it before it can land. The packet starts faster than you do, so you need to maneuver into its path or shoot through the cone.',
    ],
  },
};

// Returns the seat-specific briefing text for `scenario` + `playerId`,
// or `null` if the scenario is symmetric (no override needed) or the
// seat index is out of range.
export const getScenarioBriefingCopy = (
  scenario: ScenarioKey,
  playerId: PlayerId,
): string | null => {
  const briefing = BRIEFING_BY_SCENARIO[scenario];
  if (!briefing) {
    return null;
  }
  return briefing.seats[playerId] ?? null;
};

// Test-only handle for asserting full coverage of asymmetric scenarios
// without exporting the data shape itself.
export const asymmetricBriefingScenarioKeysForTest =
  (): readonly ScenarioKey[] =>
    Object.keys(BRIEFING_BY_SCENARIO) as ScenarioKey[];
