/** Registered by the client kernel so planning-store mutators can bump HUD without direct HUD imports. */
let bumpPlanningHud: (() => void) | undefined;

export const setPlanningHudBump = (fn: (() => void) | undefined): void => {
  bumpPlanningHud = fn;
};

export const notifyPlanningChanged = (): void => {
  bumpPlanningHud?.();
};
