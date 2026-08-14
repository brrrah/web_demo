import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { DODGE, GROUND_DASH } from '../src/combatData';
import { composeDashDirection } from '../src/groundInput';

const idle: FighterInput = { ...NO_INPUT, move: { ...NO_INPUT.move }, aim: { ...NO_INPUT.aim } };

describe('diagonal ground dash', () => {
  it('combines each cardinal double-tap with a held perpendicular direction', () => {
    const diagonal = 1 / Math.sqrt(2);
    expect(composeDashDirection({ x: 0, y: -1 }, { x: 1, y: -1 })).toEqual({ x: diagonal, y: -diagonal });
    expect(composeDashDirection({ x: 0, y: 1 }, { x: -1, y: 1 })).toEqual({ x: -diagonal, y: diagonal });
    expect(composeDashDirection({ x: -1, y: 0 }, { x: -1, y: -1 })).toEqual({ x: -diagonal, y: -diagonal });
    expect(composeDashDirection({ x: 1, y: 0 }, { x: 1, y: 1 })).toEqual({ x: diagonal, y: diagonal });
  });

  it('keeps a cardinal dash when no unambiguous perpendicular key is held', () => {
    expect(composeDashDirection({ x: 0, y: -1 }, { x: 0, y: -1 })).toEqual({ x: 0, y: -1 });
    expect(composeDashDirection({ x: 1, y: 0 }, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(composeDashDirection({ x: 0, y: 1 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
  });

  it('preserves total dash speed, duration, non-invulnerability, and dodge charges', () => {
    const sim = new CombatSimulation();
    sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
    const direction = composeDashDirection({ x: 0, y: -1 }, { x: 1, y: -1 });
    const start = { ...sim.player.position };
    sim.step({ ...idle, dash: direction }, idle);
    expect(Math.hypot(sim.player.velocity.x, sim.player.velocity.y)).toBeCloseTo(GROUND_DASH.speed, 10);
    expect(sim.player.dodgeCharges).toBe(DODGE.charges);
    expect(sim.isRollInvulnerable(sim.player)).toBe(false);
    for (let tick = 0; tick < GROUND_DASH.duration; tick += 1) sim.step(idle, idle);
    expect(Math.hypot(sim.player.position.x - start.x, sim.player.position.y - start.y)).toBeCloseTo(GROUND_DASH.speed * GROUND_DASH.duration, 8);
  });

  it('uses the slightly longer 1.8-second roll charge recovery while keeping eight invulnerable ticks', () => {
    expect(DODGE.recharge).toBe(108);
    expect(DODGE.recharge / 60).toBe(1.8);
    expect(DODGE.invulnerable).toBe(8);
  });
});
