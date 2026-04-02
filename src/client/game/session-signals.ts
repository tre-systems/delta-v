import { createDisposalScope, type Dispose } from '../reactive';
import type { ClientSession } from './session-model';
import {
  attachSessionCombatButtonsEffect,
  attachSessionFleetPanelEffect,
  attachSessionHudEffect,
  attachSessionPlanningSelectionEffect,
  type SessionCombatButtonsUI,
  type SessionFleetPanelUI,
  type SessionHudConsumer,
} from './session-planning-effects';
import {
  attachRendererGameStateEffect,
  attachSessionLatencyEffect,
  attachSessionLogisticsPanelEffect,
  attachSessionPlayerIdentityEffect,
  attachSessionWaitingScreenEffect,
  type SessionGameStateRenderer,
  type SessionIdentityConsumers,
  type SessionInteractionUI,
  type SessionLatencyUI,
  type SessionLogisticsPanelUI,
  type SessionWaitingScreenUI,
} from './session-ui-effects';

type MainSessionEffectsDeps = {
  renderer: SessionIdentityConsumers['renderer'] & SessionGameStateRenderer;
  ui: SessionIdentityConsumers['ui'] &
    SessionCombatButtonsUI &
    SessionWaitingScreenUI &
    SessionLatencyUI &
    SessionFleetPanelUI &
    SessionInteractionUI;
  hud: SessionHudConsumer;
  logistics: SessionLogisticsPanelUI;
};

/**
 * Composes the main client's reactive session effects so the composition root
 * can attach the session -> renderer/UI/HUD pipelines as one lifecycle unit.
 */
export const attachMainSessionEffects = (
  session: ClientSession,
  deps: MainSessionEffectsDeps,
): Dispose => {
  const scope = createDisposalScope();

  scope.add(attachSessionPlanningSelectionEffect(session));
  scope.add(
    attachSessionPlayerIdentityEffect(session, {
      renderer: deps.renderer,
      ui: deps.ui,
    }),
  );
  scope.add(attachSessionCombatButtonsEffect(session, deps.ui));
  scope.add(attachSessionFleetPanelEffect(session, deps.ui));
  scope.add(attachSessionHudEffect(session, deps.hud));
  scope.add(attachSessionWaitingScreenEffect(session, deps.ui));
  scope.add(attachSessionLatencyEffect(session, deps.ui));
  scope.add(attachSessionLogisticsPanelEffect(session, deps.logistics));
  scope.add(attachRendererGameStateEffect(session, deps.renderer));
  deps.ui.bindClientStateSignal(session.stateSignal);

  return () => scope.dispose();
};

export {
  attachRendererGameStateEffect,
  attachSessionCombatButtonsEffect,
  attachSessionFleetPanelEffect,
  attachSessionHudEffect,
  attachSessionLatencyEffect,
  attachSessionLogisticsPanelEffect,
  attachSessionPlanningSelectionEffect,
  attachSessionPlayerIdentityEffect,
  attachSessionWaitingScreenEffect,
};
