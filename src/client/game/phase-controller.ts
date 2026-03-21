import type { GameState } from '../../shared/types/domain';
import { playPhaseChange } from '../audio';
import { type ClientState, derivePhaseTransition } from './phase';
import type { TurnTelemetryContext } from './turn-telemetry';

export interface PhaseControllerDeps {
  gameState: GameState | null;
  playerId: number;
  lastLoggedTurn: number;
  isLocalGame: boolean;
  scenario: string;
  onTurnLogged: (turnNumber: number, context: TurnTelemetryContext) => void;
  logTurn: (turnNumber: number, playerLabel: string) => void;
  beginCombat: () => void;
  setState: (state: ClientState) => void;
  runLocalAI: () => void;
  playPhaseSound?: () => void;
}

export const transitionClientPhase = (deps: PhaseControllerDeps): void => {
  if (!deps.gameState || deps.gameState.phase === 'gameOver') {
    return;
  }

  const transition = derivePhaseTransition(
    deps.gameState,
    deps.playerId,
    deps.lastLoggedTurn,
    deps.isLocalGame,
  );

  if (transition.turnLogNumber !== null && transition.turnLogPlayerLabel) {
    deps.onTurnLogged(transition.turnLogNumber, {
      scenario: deps.scenario,
      isLocalGame: deps.isLocalGame,
    });
    deps.logTurn(transition.turnLogNumber, transition.turnLogPlayerLabel);
  }

  if (transition.beginCombatPhase) {
    deps.beginCombat();
    return;
  }

  if (!transition.nextState) {
    return;
  }

  deps.setState(transition.nextState);

  if (transition.playPhaseSound) {
    (deps.playPhaseSound ?? playPhaseChange)();
  }

  if (transition.runLocalAI) {
    deps.runLocalAI();
  }
};
