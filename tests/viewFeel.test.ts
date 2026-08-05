import { describe, expect, it } from 'vitest';
import { ARENA_BOUNDS, CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { ATTACKS, DODGE, GROUND_DASH, MOVEMENT, PARRY } from '../src/combatData';
import { VIEW_FEEL, visibleWorldSize } from '../src/presentationData';

const input = (value: Partial<FighterInput> = {}): FighterInput => ({
  ...NO_INPUT,
  ...value,
  move: value.move ?? NO_INPUT.move,
  aim: value.aim ?? { x: 1, y: 0 },
  dash: value.dash ?? null,
});
const idle = input();
const aiIdle = input({ aim: { x: -1, y: 0 } });

function ready(sim: CombatSimulation): void {
  sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
  sim.ai.position = { x: 750, y: 300 };
}

function advance(sim: CombatSimulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) sim.step(idle, aiIdle);
}

describe('user-authorized wider view and faster kinetic feel', () => {
  it('shows about nineteen percent more world while keeping the logical viewport and world center stable', () => {
    const world = visibleWorldSize();
    expect(VIEW_FEEL.worldCameraZoom).toBe(0.84);
    expect(world.width).toBeCloseTo(1142.857142857, 6);
    expect(world.height).toBeCloseTo(714.285714286, 6);
    expect(world.width / VIEW_FEEL.viewportWidth).toBeGreaterThan(1.18);
    expect(VIEW_FEEL.worldCenterX).toBe(480);
    expect(VIEW_FEEL.worldCenterY).toBe(300);
  });

  it('uses a stronger movement response and controlled two-tick braking with normalized diagonals', () => {
    const sim = new CombatSimulation(); ready(sim);
    sim.step(input({ move: { x: 1, y: 0 } }), aiIdle);
    expect(sim.player.velocity).toEqual({ x: MOVEMENT.speedX, y: 0 });
    expect(MOVEMENT.speedX).toBe(5.2);
    expect(MOVEMENT.speedY).toBe(4.4);
    sim.step(idle, aiIdle);
    expect(sim.player.velocity.x).toBeCloseTo(1.8, 8);
    sim.step(idle, aiIdle);
    expect(sim.player.velocity.x).toBe(0);

    const diagonal = new CombatSimulation(); ready(diagonal);
    diagonal.step(input({ move: { x: 1, y: 1 } }), aiIdle);
    expect(diagonal.player.velocity.x).toBeCloseTo(MOVEMENT.speedX / Math.SQRT2, 8);
    expect(diagonal.player.velocity.y).toBeCloseTo(MOVEMENT.speedY / Math.SQRT2, 8);
  });

  it('keeps dash non-invulnerable but raises its six-tick travel to seventy-nine point two units and clamps bounds', () => {
    const sim = new CombatSimulation(); ready(sim);
    const start = sim.player.position.x;
    sim.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    expect(sim.isRollInvulnerable(sim.player)).toBe(false);
    expect(sim.player.dodgeCharges).toBe(DODGE.charges);
    advance(sim, GROUND_DASH.duration);
    expect(sim.player.position.x - start).toBeCloseTo(79.2, 8);

    const wall = new CombatSimulation(); ready(wall);
    wall.player.position.x = ARENA_BOUNDS.maxX - 2;
    wall.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    advance(wall, GROUND_DASH.duration);
    expect(wall.player.position.x).toBe(ARENA_BOUNDS.maxX);
  });

  it('strengthens visual trail data and short attack commitment without changing combat timing contracts', () => {
    expect(VIEW_FEEL.dashGhostOffsets).toEqual([6.6, 4.4, 2.2]);
    expect(VIEW_FEEL.movementTrailThreshold).toBeLessThan(MOVEMENT.speedY);
    expect(ATTACKS.light.forwardDistance).toBe(10);
    expect(ATTACKS.heavy.forwardDistance).toBe(13);
    expect(ATTACKS.light).toMatchObject({ startup: 12, active: 4, recovery: 16 });
    expect(ATTACKS.heavy).toMatchObject({ startup: 24, active: 6, recovery: 24 });
    expect(PARRY.active).toBe(3);
    expect(PARRY.attackerStun).toBe(60);
    expect(DODGE.invulnerable).toBe(8);
    expect(DODGE.speed).toBe(9);
  });
});