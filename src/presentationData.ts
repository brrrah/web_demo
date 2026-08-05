export const VIEW_FEEL = {
  viewportWidth: 960,
  viewportHeight: 600,
  worldCameraZoom: 0.84,
  worldCenterX: 480,
  worldCenterY: 300,
  movementTrailThreshold: 2.7,
  movementGhostOffset: 1.65,
  dashGhostOffsets: [6.6, 4.4, 2.2] as readonly number[],
} as const;

export function visibleWorldSize(): { width: number; height: number } {
  return {
    width: VIEW_FEEL.viewportWidth / VIEW_FEEL.worldCameraZoom,
    height: VIEW_FEEL.viewportHeight / VIEW_FEEL.worldCameraZoom,
  };
}
export const PARRY_READABILITY = {
  countdownTicks: 6,
  ringStartRadius: 70,
  ringEndRadius: 24,
  ringWidth: 6,
  sweepWidth: 5,
  windupFontSize: 18,
  countdownFontSize: 26,
} as const;

export interface ParryCueStyle {
  label: string;
  color: string;
  background: string;
}

export function parryCueStyle(ringActive: boolean, countdownTicks: number | null, cueAllowed: boolean): ParryCueStyle | null {
  if (!ringActive || countdownTicks === null || !cueAllowed) return null;
  if (countdownTicks <= 1) return { label: 'LMB!', color: '#ffffff', background: '#b31e24ee' };
  if (countdownTicks <= 3) return { label: `READY ${countdownTicks}`, color: '#ffffff', background: '#a85000e8' };
  return { label: `${countdownTicks}`, color: '#211600', background: '#ffd84fee' };
}