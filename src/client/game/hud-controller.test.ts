import { describe, expect, it, vi } from 'vitest';

import { must } from '../../shared/assert';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { Renderer } from '../renderer/renderer';
import type { UIManager } from '../ui/ui';
import { createHudController } from './hud-controller';
import type { ClientState } from './phase';
import { createPlanningStore } from './planning';

const createHarness = (clientState: ClientState) => {
  const map = buildSolarSystemMap();
  const gameState = createGameOrThrow(
    SCENARIOS.duel,
    map,
    asGameId('HUD0'),
    findBaseHex,
  );
  const planningState = createPlanningStore();
  const selectedShip = gameState.ships.find((ship) => ship.owner === 0);

  if (!selectedShip) {
    throw new Error('Expected duel scenario to provide a player ship');
  }

  planningState.setSelectedShipId(selectedShip.id);

  const ui = {
    updateHUD: vi.fn(),
    updateFleetStatus: vi.fn(),
    updateShipList: vi.fn(),
    updateSoundButton: vi.fn(),
    log: {
      logText: vi.fn(),
    },
  } as unknown as UIManager;

  const renderer = {
    camera: {
      screenToWorld: vi.fn(),
    },
  } as unknown as Renderer;

  const controller = createHudController({
    getGameState: () => gameState,
    getPlayerId: () => 0,
    getClientState: () => clientState,
    getPlanningState: () => planningState,
    getMap: () => map,
    ui,
    renderer,
    tooltipEl: {} as HTMLElement,
  });

  return { controller, gameState, map, planningState, selectedShip, ui };
};

describe('hud-controller', () => {
  it('adds movement presentation overrides while movement animation is active', () => {
    const { controller, ui } = createHarness('playing_movementAnim');

    controller.updateHUD();

    expect(ui.updateHUD).toHaveBeenCalledWith(
      expect.objectContaining({
        statusOverrideText: 'Ships moving...',
        suppressActionButtons: true,
      }),
    );
  });

  it('shows waiting status during opponent turn', () => {
    const { controller, ui } = createHarness('playing_opponentTurn');

    controller.updateHUD();

    expect(ui.updateHUD).toHaveBeenCalledWith(
      expect.objectContaining({
        statusOverrideText: 'Waiting for opponent...',
        suppressActionButtons: false,
      }),
    );
  });

  it('leaves HUD presentation unsuppressed during normal turn states', () => {
    const { controller, ui } = createHarness('playing_astrogation');

    controller.updateHUD();

    expect(ui.updateHUD).toHaveBeenCalledWith(
      expect.objectContaining({
        statusOverrideText: null,
        suppressActionButtons: false,
      }),
    );
  });

  it('does not warn that an explicitly queued legal landing is a crash', () => {
    const { controller, gameState, map, planningState, selectedShip, ui } =
      createHarness('playing_astrogation');
    const marsBase = must(findBaseHex(map, 'Mars'));
    selectedShip.position = { q: marsBase.q, r: marsBase.r + 1 };
    selectedShip.velocity = { dq: 0, dr: -1 };
    selectedShip.pendingGravityEffects = [
      {
        hex: { q: marsBase.q, r: marsBase.r + 1 },
        direction: 3,
        bodyName: 'Mars',
        strength: 'full',
        ignored: false,
      },
    ];
    gameState.phase = 'astrogation';
    planningState.setShipBurn(selectedShip.id, 0, true);
    planningState.setShipLanding(selectedShip.id, true);

    controller.updateHUD();

    expect(ui.updateHUD).toHaveBeenCalledWith(
      expect.objectContaining({
        astrogationCtx: expect.objectContaining({
          anyCrashed: false,
          crashBody: null,
          selectedShipLandingBody: 'Mars',
          selectedShipLandingSet: true,
        }),
      }),
    );
  });
});
