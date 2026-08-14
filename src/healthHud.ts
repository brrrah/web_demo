export type HealthBarSide = 'left' | 'right';

export const HEALTH_HUD = {
  y: 20,
  leftX: 24,
  rightX: 596,
  width: 340,
  height: 24,
  inset: 3,
} as const;

export function healthRatio(hp: number, maxHp = 100): number {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
  return Math.max(0, Math.min(1, hp / maxHp));
}

export function healthFillRect(side: HealthBarSide, hp: number, maxHp = 100): { x: number; y: number; width: number; height: number } {
  const innerWidth = HEALTH_HUD.width - HEALTH_HUD.inset * 2;
  const width = innerWidth * healthRatio(hp, maxHp);
  const baseX = side === 'left' ? HEALTH_HUD.leftX + HEALTH_HUD.inset : HEALTH_HUD.rightX + HEALTH_HUD.width - HEALTH_HUD.inset - width;
  return {
    x: baseX,
    y: HEALTH_HUD.y + HEALTH_HUD.inset,
    width,
    height: HEALTH_HUD.height - HEALTH_HUD.inset * 2,
  };
}
