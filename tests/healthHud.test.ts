import { describe, expect, it } from 'vitest';
import { HEALTH_HUD, healthFillRect, healthRatio } from '../src/healthHud';

describe('top health HUD layout', () => {
  it('clamps health ratios to the visible zero-to-one range', () => {
    expect(healthRatio(100)).toBe(1);
    expect(healthRatio(45)).toBe(0.45);
    expect(healthRatio(-20)).toBe(0);
    expect(healthRatio(140)).toBe(1);
  });

  it('anchors the player fill left and the AI fill right', () => {
    const player = healthFillRect('left', 50);
    const ai = healthFillRect('right', 50);
    expect(player.width).toBe(ai.width);
    expect(player.x).toBe(HEALTH_HUD.leftX + HEALTH_HUD.inset);
    expect(ai.x + ai.width).toBe(HEALTH_HUD.rightX + HEALTH_HUD.width - HEALTH_HUD.inset);
  });

  it('produces an empty visible fill at zero health', () => {
    expect(healthFillRect('left', 0).width).toBe(0);
    expect(healthFillRect('right', 0).width).toBe(0);
  });
});
