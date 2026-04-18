import type { Ship } from '../../shared/types/domain';
import type { HUDInput } from './hud';

type CreateHudActionsInput = {
  update: (input: Omit<HUDInput, 'isMobile'>) => void;
  updateLatency: (latencyMs: number | null) => void;
  updateFleetStatus: (status: string, ariaLabel?: string) => void;
  updateShipList: (
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) => void;
  toggleHelpOverlay: () => void;
  openHelpSection: (sectionElementId: string) => void;
  updateSoundButton: (muted: boolean) => void;
  showAttackButton: (isVisible: boolean) => void;
  showFireButton: (isVisible: boolean, count: number) => void;
};

export const createHudActions = ({
  update,
  updateLatency,
  updateFleetStatus,
  updateShipList,
  toggleHelpOverlay,
  openHelpSection,
  updateSoundButton,
  showAttackButton,
  showFireButton,
}: CreateHudActionsInput) => ({
  updateHUD: (input: Omit<HUDInput, 'isMobile'>) => {
    update(input);
  },
  updateLatency,
  updateFleetStatus,
  updateShipList,
  toggleHelpOverlay,
  openHelpSection,
  updateSoundButton,
  showAttackButton,
  showFireButton,
});
