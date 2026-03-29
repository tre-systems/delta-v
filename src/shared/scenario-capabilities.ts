// Derived scenario capability layer — single source of defaults and
// feature predicates. Replaces scattered scenarioRules property
// reads with intent-revealing accessors (backlog #24).

import type { OrdnanceType } from './constants';
import type {
  FleetConversion,
  FleetPurchaseOption,
  Reinforcement,
  ScenarioRules,
} from './types/domain';

export interface ScenarioCapabilities {
  combatEnabled: boolean;
  logisticsEnabled: boolean;
  passengerRescueEnabled: boolean;
  planetaryDefenseEnabled: boolean;
  hiddenIdentityInspection: boolean;
  targetWinRequiresPassengers: boolean;
  isCheckpointRace: boolean;
  escapeEdge: 'any' | 'north';
  checkpointBodies: readonly string[];
  sharedBases: readonly string[];
  allowedOrdnanceTypes: ReadonlySet<OrdnanceType>;
  availableFleetPurchases: readonly FleetPurchaseOption[] | null;
  reinforcements: readonly Reinforcement[] | null;
  fleetConversion: FleetConversion | null;
}

const ALL_ORDNANCE: ReadonlySet<OrdnanceType> = new Set([
  'mine',
  'torpedo',
  'nuke',
]);

export const deriveCapabilities = (
  rules: ScenarioRules,
): ScenarioCapabilities => {
  const allowed = rules.allowedOrdnanceTypes;
  return {
    combatEnabled: !rules.combatDisabled,
    logisticsEnabled: !!rules.logisticsEnabled,
    passengerRescueEnabled: !!rules.passengerRescueEnabled,
    planetaryDefenseEnabled: rules.planetaryDefenseEnabled !== false,
    hiddenIdentityInspection: rules.hiddenIdentityInspection === true,
    targetWinRequiresPassengers: !!rules.targetWinRequiresPassengers,
    isCheckpointRace: rules.checkpointBodies != null,
    escapeEdge: rules.escapeEdge ?? 'any',
    checkpointBodies: rules.checkpointBodies ?? [],
    sharedBases: rules.sharedBases ?? [],
    allowedOrdnanceTypes:
      allowed && allowed.length > 0 ? new Set(allowed) : ALL_ORDNANCE,
    availableFleetPurchases: rules.availableFleetPurchases ?? null,
    reinforcements: rules.reinforcements ?? null,
    fleetConversion: rules.fleetConversion ?? null,
  };
};
