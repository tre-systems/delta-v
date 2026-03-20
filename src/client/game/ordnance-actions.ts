import type { GameState } from '../../shared/types';
import {
  resolveBaseEmplacementPlan,
  resolveOrdnanceLaunchPlan,
} from './ordnance';
import type { PlanningState } from './planning';
import type { GameTransport } from './transport';

export interface OrdnanceActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getTransport: () => GameTransport | null;
  planningState: PlanningState;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  logText: (text: string) => void;
}

export const sendOrdnanceLaunch = (
  deps: OrdnanceActionDeps,
  ordType: 'mine' | 'torpedo' | 'nuke',
) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();
  if (!gameState || deps.getClientState() !== 'playing_ordnance' || !transport)
    return;
  const plan = resolveOrdnanceLaunchPlan(
    gameState,
    deps.planningState,
    ordType,
  );
  if (!plan.ok) {
    if (plan.message) {
      deps.showToast(plan.message, plan.level!);
    }
    return;
  }
  deps.logText(`${plan.shipName} launched ${ordType}`);
  transport.submitOrdnance([plan.launch!]);
};

export const sendEmplaceBase = (deps: OrdnanceActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();
  if (!gameState || deps.getClientState() !== 'playing_ordnance' || !transport)
    return;
  const plan = resolveBaseEmplacementPlan(
    gameState,
    deps.planningState.selectedShipId!,
  );
  if (!plan.ok) {
    if (plan.message) {
      deps.showToast(plan.message, plan.level!);
    }
    return;
  }
  transport.submitEmplacement(plan.emplacements!);
};

export const sendSkipOrdnance = (deps: OrdnanceActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();
  if (!gameState || deps.getClientState() !== 'playing_ordnance' || !transport)
    return;
  transport.skipOrdnance();
};
