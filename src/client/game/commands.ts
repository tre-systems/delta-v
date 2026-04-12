import type { HexCoord } from '../../shared/hex';
import type { FleetPurchase, OrdnanceType } from '../../shared/types/domain';
import type { CombatTargetPlan } from '../game/combat';
import type { KeyboardAction } from './keyboard';

export type GameCommand =
  // Astrogation
  | { type: 'confirmOrders' }
  | { type: 'undoBurn' }
  | { type: 'landFromOrbit' }
  | { type: 'setBurnDirection'; shipId?: string; direction: number | null }
  | { type: 'setOverloadDirection'; shipId: string; direction: number | null }
  | {
      type: 'setWeakGravityChoices';
      shipId: string;
      choices: Record<string, boolean>;
    }
  | { type: 'clearSelectedBurn' }
  | { type: 'skipShipBurn' }
  // Ordnance (batch)
  | { type: 'confirmOrdnance' }
  | { type: 'skipOrdnanceShip' }
  // Combat
  | { type: 'queueAttack' }
  | { type: 'fireAllAttacks' }
  | { type: 'confirmSingleAttack' }
  | { type: 'endCombat' }
  | { type: 'skipCombat' }
  | { type: 'adjustCombatStrength'; delta: number }
  | { type: 'resetCombatStrength' }
  | { type: 'setCombatPlan'; plan: CombatTargetPlan; selectedShipId?: string }
  | { type: 'clearCombatSelection' }
  | { type: 'undoQueuedAttack' }
  // Logistics
  | { type: 'skipLogistics' }
  | { type: 'confirmTransfers' }
  // Ordnance
  | { type: 'launchOrdnance'; ordType: OrdnanceType }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  // Fleet building
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'surrender'; shipIds: string[] }
  // Navigation / camera
  | { type: 'selectShip'; shipId: string }
  | { type: 'deselectShip' }
  | { type: 'cycleShip'; direction: 1 | -1 }
  | { type: 'focusNearestEnemy' }
  | { type: 'focusOwnFleet' }
  | { type: 'panCamera'; dx: number; dy: number }
  | { type: 'zoomCamera'; factor: number }
  // UI toggles
  | { type: 'toggleLog' }
  | { type: 'toggleHelp' }
  | { type: 'toggleMute' }
  // lifecycle
  | { type: 'requestRematch' }
  | { type: 'exitToMenu' }
  // Torpedo / Ordnance
  | { type: 'setTorpedoAccel'; direction: number | null; steps: (1 | 2) | null }
  | { type: 'clearTorpedoAcceleration' }
  // Hover
  | { type: 'setHoverHex'; hex: HexCoord | null };

export const keyboardActionToCommand = (
  action: KeyboardAction,
): GameCommand | null => {
  switch (action.kind) {
    case 'none':
      return null;
    case 'cycleShip':
      return { type: 'cycleShip', direction: action.direction };
    case 'clearCombatSelection':
      return { type: 'clearCombatSelection' };
    case 'undoQueuedAttack':
      return { type: 'undoQueuedAttack' };
    case 'clearTorpedoAcceleration':
      return { type: 'clearTorpedoAcceleration' };
    case 'deselectShip':
      return { type: 'deselectShip' };
    case 'confirmOrders':
      return { type: 'confirmOrders' };
    case 'skipOrdnance':
      return { type: 'skipOrdnance' };
    case 'queueAttack':
      return { type: 'queueAttack' };
    case 'fireAllAttacks':
      return { type: 'fireAllAttacks' };
    case 'confirmSingleAttack':
      return { type: 'confirmSingleAttack' };
    case 'endCombat':
      return { type: 'endCombat' };
    case 'skipCombat':
      return { type: 'skipCombat' };
    case 'confirmTransfers':
      return { type: 'confirmTransfers' };
    case 'adjustCombatStrength':
      return { type: 'adjustCombatStrength', delta: action.delta };
    case 'launchOrdnance':
      return { type: 'launchOrdnance', ordType: action.ordnanceType };
    case 'setBurnDirection':
      return { type: 'setBurnDirection', direction: action.direction };
    case 'clearSelectedBurn':
      return { type: 'clearSelectedBurn' };
    case 'skipShipBurn':
      return { type: 'skipShipBurn' };
    case 'confirmOrdnance':
      return { type: 'confirmOrdnance' };
    case 'skipOrdnanceShip':
      return { type: 'skipOrdnanceShip' };
    case 'resetCombatStrength':
      return { type: 'resetCombatStrength' };
    case 'focusNearestEnemy':
      return { type: 'focusNearestEnemy' };
    case 'focusOwnFleet':
      return { type: 'focusOwnFleet' };
    case 'toggleLog':
      return { type: 'toggleLog' };
    case 'panCamera':
      return { type: 'panCamera', dx: action.dx, dy: action.dy };
    case 'zoomCamera':
      return { type: 'zoomCamera', factor: action.factor };
    case 'toggleHelp':
      return { type: 'toggleHelp' };
    case 'toggleMute':
      return { type: 'toggleMute' };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};
