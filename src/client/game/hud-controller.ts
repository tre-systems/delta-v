import { hexKey, pixelToHex } from '../../shared/hex';
import { computeCourse } from '../../shared/movement';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { isMuted } from '../audio';
import { hide, setTrustedHTML, show } from '../dom';
import type { Renderer } from '../renderer/renderer';
import { HEX_SIZE } from '../renderer/renderer';
import type { UIManager } from '../ui/ui';
import { deriveScenarioBriefingEntries } from './briefing';
import { deriveHudViewModel } from './helpers';
import { getTooltipShip } from './hover';
import { buildHudChromeInputFromViewModel } from './hud-chrome-input';
import { getObjectiveBearingScreenDegrees } from './navigation';
import type { ClientState } from './phase';
import type { PlanningStore } from './planning';
import { getSelectedShip } from './selection';
import { buildShipTooltipHtml } from './tooltip';

export interface HudControllerDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => PlayerId;
  getClientState: () => ClientState;
  getPlanningState: () => PlanningStore;
  getMap: () => SolarSystemMap;
  getLatencyMs: () => number;
  getIsLocalGame: () => boolean;
  ui: UIManager;
  renderer: Renderer;
  tooltipEl: HTMLElement;
}

export const createHudController = (deps: HudControllerDeps) => {
  const computeCrashWarning = (): {
    anyCrashed: boolean;
    crashBody: string | null;
  } => {
    const state = deps.getGameState();
    const map = deps.getMap();

    if (!state || !map) {
      return { anyCrashed: false, crashBody: null };
    }

    if (state.phase !== 'astrogation') {
      return { anyCrashed: false, crashBody: null };
    }
    const planning = deps.getPlanningState();
    for (const ship of state.ships) {
      if (ship.owner !== deps.getPlayerId() || ship.lifecycle === 'destroyed') {
        continue;
      }
      const burn = planning.burns.get(ship.id) ?? null;

      if (burn === null) continue;
      const overload = planning.overloads.get(ship.id) ?? null;
      const weakGravityChoices = planning.weakGravityChoices.get(ship.id) ?? {};
      const course = computeCourse(ship, burn, map, {
        overload,
        weakGravityChoices,
        destroyedBases: state.destroyedBases,
      });

      if (course.outcome === 'crash') {
        return { anyCrashed: true, crashBody: course.crashBody };
      }
    }

    return { anyCrashed: false, crashBody: null };
  };

  const computeObjectiveBearingDeg = (): number | null => {
    const state = deps.getGameState();
    const map = deps.getMap();

    if (!state || !map) {
      return null;
    }

    const planning = deps.getPlanningState();
    const ship = getSelectedShip(
      state,
      deps.getPlayerId(),
      planning.selectedShipId,
    );

    return getObjectiveBearingScreenDegrees(
      state,
      deps.getPlayerId(),
      map,
      HEX_SIZE,
      ship,
    );
  };

  return {
    /** Derives HUD state and pushes it through `buildHudChromeInputFromViewModel` (single path to `ui.updateHUD`). */
    updateHUD: () => {
      const state = deps.getGameState();

      if (!state) return;
      const planning = deps.getPlanningState();
      const hud = deriveHudViewModel(state, deps.getPlayerId(), planning);

      if (
        hud.selectedId !== null &&
        planning.selectedShipId !== hud.selectedId
      ) {
        const ship = state.ships.find((s) => s.id === hud.selectedId);
        if (ship) {
          planning.selectShip(hud.selectedId, hexKey(ship.position));
        } else {
          planning.setSelectedShipId(hud.selectedId);
        }
      }

      deps.ui.updateHUD(
        buildHudChromeInputFromViewModel(
          hud,
          computeCrashWarning(),
          computeObjectiveBearingDeg(),
        ),
      );

      const latencyMs = deps.getLatencyMs();
      deps.ui.updateLatency(
        !deps.getIsLocalGame() && latencyMs >= 0 ? latencyMs : null,
      );
      deps.ui.updateFleetStatus(hud.fleetStatus);
      deps.ui.updateShipList(hud.myShips, hud.selectedId, planning.burns);
    },

    updateTooltip: (screenX: number, screenY: number) => {
      const gameState = deps.getGameState();
      const worldPos = deps.renderer.camera.screenToWorld(screenX, screenY);
      const hoverHex = pixelToHex(worldPos, HEX_SIZE);
      const ship = getTooltipShip(
        gameState,
        deps.getClientState(),
        deps.getPlayerId(),
        hoverHex,
      );

      if (!ship || !gameState) {
        hide(deps.tooltipEl);
        return;
      }
      setTrustedHTML(
        deps.tooltipEl,
        buildShipTooltipHtml(
          gameState,
          ship,
          deps.getPlayerId(),
          deps.getMap(),
        ),
      );
      show(deps.tooltipEl, 'block');
      deps.tooltipEl.style.left = `${screenX + 12}px`;
      deps.tooltipEl.style.top = `${screenY - 10}px`;
    },

    logScenarioBriefing: () => {
      const state = deps.getGameState();

      if (!state) return;
      for (const entry of deriveScenarioBriefingEntries(
        state,
        deps.getPlayerId(),
      )) {
        deps.ui.log.logText(entry.text, entry.cssClass);
      }
    },

    updateSoundButton: () => {
      deps.ui.updateSoundButton(isMuted());
    },
  };
};

export type HudController = ReturnType<typeof createHudController>;
