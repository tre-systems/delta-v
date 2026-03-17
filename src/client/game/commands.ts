import type { FleetPurchase } from '../../shared/types';
import type { KeyboardAction } from './keyboard';

export type GameCommand =
  // Astrogation
  | { type: 'confirmOrders' }
  | { type: 'undoBurn' }
  | { type: 'setBurnDirection'; direction: number }
  | { type: 'clearSelectedBurn' }
  // Combat
  | { type: 'queueAttack' }
  | { type: 'fireAllAttacks' }
  | { type: 'skipCombat' }
  | { type: 'adjustCombatStrength'; delta: number }
  | { type: 'resetCombatStrength' }
  | { type: 'clearCombatSelection' }
  | { type: 'undoQueuedAttack' }
  // Ordnance
  | { type: 'launchOrdnance'; ordType: 'mine' | 'torpedo' | 'nuke' }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  // Fleet building
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
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
  // Lifecycle
  | { type: 'requestRematch' }
  | { type: 'exitToMenu' }
  // Torpedo
  | { type: 'clearTorpedoAcceleration' };

export const keyboardActionToCommand = (action: KeyboardAction): GameCommand | null => {
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
    case 'skipCombat':
      return { type: 'skipCombat' };
    case 'adjustCombatStrength':
      return { type: 'adjustCombatStrength', delta: action.delta };
    case 'launchOrdnance':
      return { type: 'launchOrdnance', ordType: action.ordnanceType };
    case 'setBurnDirection':
      return { type: 'setBurnDirection', direction: action.direction };
    case 'clearSelectedBurn':
      return { type: 'clearSelectedBurn' };
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
  }
};
