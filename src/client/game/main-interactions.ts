import type { AIDifficulty } from '../../shared/ai/types';
import { SHIP_STATS } from '../../shared/constants';
import type {
  FleetPurchase,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { isShipFleetPurchase } from '../../shared/types/domain';
import type { UIEvent } from '../ui/events';
import type { ActionDeps } from './action-deps';
import {
  type CommandRouterDeps,
  type CommandRouterSessionRead,
  dispatchGameCommand,
} from './command-router';
import { type GameCommand, keyboardActionToCommand } from './commands';
import { type InputEvent, interpretInput } from './input-events';
import { deriveInteractionMode } from './interaction-fsm';
import type { KeyboardAction } from './keyboard';
import {
  beginJoinGameFromMain,
  beginSpectateGameFromMain,
  type MainNetworkDeps,
  startLocalGameFromMain,
} from './main-session-network';
import type { ReplayController } from './replay-controller';
import type { SessionApi } from './session-api';
import type { ClientSession } from './session-model';
import { resolveUIEventPlan } from './ui-event-router';

type MainInteractionSession = Pick<
  ClientSession,
  | 'gameStateSignal'
  | 'isLocalGame'
  | 'logisticsStateSignal'
  | 'planningState'
  | 'playerId'
  | 'stateSignal'
  | 'transport'
>;

type MainInteractionUI = CommandRouterDeps['ui'] & {
  showFleetWaiting: () => void;
  toggleHelpOverlay: () => void;
};

type MainInteractionCamera = {
  cycleShip: (direction: 1 | -1) => void;
  focusNearestEnemy: () => void;
  focusOwnFleet: () => void;
};

type MainInteractionHud = {
  updateSoundButton: () => void;
};

type MainInteractionReplay = Pick<
  ReplayController,
  'selectMatch' | 'toggleReplay' | 'togglePlay' | 'stepReplay'
>;

type MainInteractionDeps = {
  canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>;
  map: SolarSystemMap;
  ctx: MainInteractionSession;
  actionDeps: Pick<
    ActionDeps,
    'astrogationDeps' | 'combatDeps' | 'ordnanceDeps'
  >;
  ui: MainInteractionUI;
  renderer: CommandRouterDeps['renderer'];
  camera: MainInteractionCamera;
  hud: MainInteractionHud;
  replayController: MainInteractionReplay;
  sessionApi: Pick<SessionApi, 'createGame'>;
  mainNetworkDeps: MainNetworkDeps;
  setAIDifficulty: (difficulty: AIDifficulty) => void;
  exitToMenu: () => void;
  trackEvent: (event: string, props?: Record<string, unknown>) => void;
};

export type MainInteractionController = {
  dispatch: (cmd: GameCommand) => void;
  handleInput: (event: InputEvent) => void;
  handleKeyboardAction: (action: KeyboardAction) => void;
  handleUIEvent: (event: UIEvent) => void;
  joinGame: (code: string, playerToken?: string | null) => void;
  spectateGame: (code: string) => void;
  toggleHelp: () => void;
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
};

const createCommandSessionRead = (
  ctx: MainInteractionSession,
): CommandRouterSessionRead => ({
  getState: () => ctx.stateSignal.peek(),
  getPlayerId: () => ctx.playerId as PlayerId,
  getGameState: () => ctx.gameStateSignal.peek(),
  getTransport: () => ctx.transport,
  getLogisticsState: () => ctx.logisticsStateSignal.peek(),
  planningState: ctx.planningState,
});

export const createMainInteractionController = (
  deps: MainInteractionDeps,
): MainInteractionController => {
  const sendFleetReady = (purchases: FleetPurchase[]) => {
    const gameState = deps.ctx.gameStateSignal.peek();
    if (
      !gameState ||
      deps.ctx.stateSignal.peek() !== 'playing_fleetBuilding' ||
      !deps.ctx.transport
    ) {
      return;
    }

    const shipTypes: Record<string, number> = {};
    let totalCost = 0;
    for (const p of purchases) {
      if (isShipFleetPurchase(p)) {
        shipTypes[p.shipType] = (shipTypes[p.shipType] ?? 0) + 1;
        totalCost += SHIP_STATS[p.shipType].cost;
      }
    }
    deps.trackEvent('fleet_ready_submitted', {
      scenario: gameState.scenario,
      shipCount: purchases.filter(isShipFleetPurchase).length,
      totalCost,
      shipTypes,
    });

    deps.ctx.transport.submitFleetReady(purchases);
    if (!deps.ctx.isLocalGame) {
      deps.ui.showFleetWaiting();
    }
  };

  const sendSurrender = (shipIds: string[]) => {
    const gameState = deps.ctx.gameStateSignal.peek();
    if (!gameState || !deps.ctx.transport) return;
    deps.trackEvent('surrender_submitted', {
      turn: gameState.turnNumber,
      scenario: gameState.scenario,
      mode: deps.ctx.isLocalGame ? 'local' : 'multiplayer',
    });
    deps.ctx.transport.submitSurrender(shipIds);
  };

  const sendRematch = () => {
    deps.ctx.transport?.requestRematch();
  };

  const toggleHelp = () => {
    deps.ui.toggleHelpOverlay();
  };

  const commandSession = createCommandSessionRead(deps.ctx);

  const createCommandRouterDeps = (): CommandRouterDeps => ({
    ctx: commandSession,
    astrogationDeps: deps.actionDeps.astrogationDeps,
    combatDeps: deps.actionDeps.combatDeps,
    ordnanceDeps: deps.actionDeps.ordnanceDeps,
    ui: deps.ui,
    renderer: deps.renderer,
    getCanvasCenter: () => ({
      x: deps.canvas.clientWidth / 2,
      y: deps.canvas.clientHeight / 2,
    }),
    cycleShip: (direction) => deps.camera.cycleShip(direction as 1 | -1),
    focusNearestEnemy: () => deps.camera.focusNearestEnemy(),
    focusOwnFleet: () => deps.camera.focusOwnFleet(),
    sendFleetReady: (purchases) => sendFleetReady(purchases),
    sendSurrender: (shipIds) => sendSurrender(shipIds),
    sendRematch: () => sendRematch(),
    exitToMenu: () => deps.exitToMenu(),
    toggleHelp: () => toggleHelp(),
    updateSoundButton: () => deps.hud.updateSoundButton(),
  });

  const commandRouterDeps = createCommandRouterDeps();

  const dispatch = (cmd: GameCommand) => {
    dispatchGameCommand(commandRouterDeps, cmd);
  };

  const handleInput = (event: InputEvent) => {
    const interactionMode = deriveInteractionMode(deps.ctx.stateSignal.peek());
    if (interactionMode === 'animating') {
      return;
    }

    const commands = interpretInput(
      event,
      deps.ctx.gameStateSignal.peek(),
      interactionMode,
      deps.map,
      deps.ctx.playerId as PlayerId,
      deps.ctx.planningState,
    );

    if (!commands) return;
    for (const cmd of commands) {
      dispatch(cmd);
    }
  };

  const handleKeyboardAction = (action: KeyboardAction) => {
    const cmd = keyboardActionToCommand(action);

    if (cmd) {
      dispatch(cmd);
    }
  };

  const joinGame = (code: string, playerToken: string | null = null) => {
    beginJoinGameFromMain(deps.mainNetworkDeps, code, playerToken);
  };

  const spectateGame = (code: string) => {
    beginSpectateGameFromMain(deps.mainNetworkDeps, code);
  };

  const handleUIEvent = (event: UIEvent) => {
    const plan = resolveUIEventPlan(event);

    switch (plan.kind) {
      case 'createGame':
        deps.sessionApi.createGame(plan.scenario);
        return;
      case 'startSinglePlayer':
        deps.setAIDifficulty(plan.difficulty);
        startLocalGameFromMain(deps.mainNetworkDeps, plan.scenario);
        return;
      case 'joinGame':
        joinGame(plan.code, plan.playerToken);
        return;
      case 'command':
        dispatch(plan.command);
        return;
      case 'selectReplayMatch':
        deps.replayController.selectMatch(plan.direction);
        return;
      case 'toggleReplay':
        void deps.replayController.toggleReplay();
        return;
      case 'replayPlayPause':
        deps.replayController.togglePlay();
        return;
      case 'replayNav':
        deps.replayController.stepReplay(plan.direction);
        return;
      case 'sendChat':
        deps.ctx.transport?.sendChat(plan.text);
        return;
      case 'trackOnly':
        deps.trackEvent(plan.event);
        return;
    }
  };

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'info',
  ) => {
    deps.ui.overlay.showToast(message, type);
  };

  return {
    dispatch,
    handleInput,
    handleKeyboardAction,
    handleUIEvent,
    joinGame,
    spectateGame,
    toggleHelp,
    showToast,
  };
};
