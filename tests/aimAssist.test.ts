import { describe, expect, it } from 'vitest';
import { resolveAttackAim } from '../src/aimAssist';
import { CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { AIM_ASSIST, ATTACKS, FEINT, FIXED_HZ } from '../src/combatData';
import { activeWeaponSweep, combatPose, expectedContactActiveTick, facingAngle, normalizeAngle } from '../src/combatMotion';

const input = (value: Partial<FighterInput>): FighterInput => ({ ...NO_INPUT, ...value, move: value.move ?? NO_INPUT.move, aim: value.aim ?? { x: 1, y: 0 } });
const idle = input({});
const aiIdle = input({ aim: { x: -1, y: 0 } });
const vectorAt = (angle: number, distance = 1) => ({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });

function placeTarget(sim: CombatSimulation, angle: number, distance = 70): void {
  sim.player.position = { x: 400, y: 300 };
  const offset = vectorAt(angle, distance);
  sim.ai.position = { x: 400 + offset.x, y: 300 + offset.y };
  sim.player.facing = { x: 1, y: 0 }; sim.ai.facing = { x: -1, y: 0 };
  sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
}

function finishLight(sim: CombatSimulation): void {
  sim.step(input({ light: true }), aiIdle);
  for (let frame = 0; frame < ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery + 6; frame += 1) sim.step(idle, aiIdle);
}

describe('GAME-P0E proximity aim assist and spatial counterplay', () => {
  it('applies only a weak bounded correction inside the near cone', () => {
    const targetAngle = 15 * Math.PI / 180;
    const result = resolveAttackAim({ x: 0, y: 0 }, { x: 1, y: 0 }, vectorAt(targetAngle, 100));
    expect(result.applied).toBe(true);
    expect(result.correction).toBeCloseTo(AIM_ASSIST.maxCorrection, 10);
    expect(facingAngle(result.facing)).toBeCloseTo(AIM_ASSIST.maxCorrection, 10);
    expect(Math.abs(targetAngle - facingAngle(result.facing))).toBeGreaterThan(0);
  });

  it('does not activate outside the range or intended-direction cone', () => {
    const nearAngle = AIM_ASSIST.maxTargetAngle / 2;
    const far = resolveAttackAim({ x: 0, y: 0 }, { x: 1, y: 0 }, vectorAt(nearAngle, AIM_ASSIST.maxRange + 0.01));
    const side = resolveAttackAim({ x: 0, y: 0 }, { x: 1, y: 0 }, vectorAt(AIM_ASSIST.maxTargetAngle + 0.001, 70));
    expect(far.applied).toBe(false); expect(far.facing).toEqual({ x: 1, y: 0 });
    expect(side.applied).toBe(false); expect(side.facing).toEqual({ x: 1, y: 0 });
  });

  it('snapshots attack facing once and never creates persistent target lock', () => {
    const sim = new CombatSimulation(); placeTarget(sim, 12 * Math.PI / 180);
    sim.step(input({ light: true, aim: { x: 1, y: 0 } }), aiIdle);
    const attackFacing = facingAngle(sim.player.facing);
    expect(attackFacing).toBeCloseTo(AIM_ASSIST.maxCorrection, 10);
    sim.ai.position = { x: 400, y: 220 };
    sim.step(input({ aim: { x: 0, y: -1 } }), aiIdle);
    expect(facingAngle(sim.player.facing)).toBeCloseTo(attackFacing, 10);
    for (let frame = 0; frame < ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery + 2; frame += 1) sim.step(input({ aim: { x: 0, y: -1 } }), aiIdle);
    sim.step(input({ aim: { x: 0, y: -1 } }), aiIdle);
    expect(facingAngle(sim.player.facing)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('hits a near frontal target but not side, rear, or out-of-range targets', () => {
    const front = new CombatSimulation(); placeTarget(front, 12 * Math.PI / 180); finishLight(front); expect(front.ai.hp).toBeLessThan(100);
    const side = new CombatSimulation(); placeTarget(side, 105 * Math.PI / 180); finishLight(side); expect(side.ai.hp).toBe(100);
    const rear = new CombatSimulation(); placeTarget(rear, Math.PI); finishLight(rear); expect(rear.ai.hp).toBe(100);
    const far = new CombatSimulation(); placeTarget(far, 8 * Math.PI / 180, AIM_ASSIST.maxRange + 1); finishLight(far); expect(far.ai.hp).toBe(100);
  });

  it('keeps visual weapon pose, simulation sweep, and assisted contact on one tick', () => {
    const sim = new CombatSimulation(); placeTarget(sim, 12 * Math.PI / 180);
    sim.step(input({ light: true }), aiIdle);
    const relativeTargetAngle = normalizeAngle(12 * Math.PI / 180 - facingAngle(sim.player.facing));
    const predicted = expectedContactActiveTick('light', relativeTargetAngle, 70);
    expect(predicted).not.toBeNull();
    for (let frame = 0; frame < 40 && !sim.events.some((event) => event.type === 'hit' && event.actor === 'player'); frame += 1) sim.step(idle, aiIdle);
    const hit = sim.events.find((event) => event.type === 'hit' && event.actor === 'player');
    expect(hit).toBeDefined();
    const sweep = activeWeaponSweep(sim.player)!; const pose = combatPose(sim.player);
    expect(hit!.contactActiveTick).toBe(predicted); expect(sweep.activeTick).toBe(predicted);
    expect(pose.weaponAngle).toBeCloseTo(facingAngle(sim.player.facing) + sweep.currentAngle, 10);
    expect(pose.tip.x).toBeCloseTo(sim.player.position.x + Math.cos(pose.weaponAngle) * sweep.reach, 10);
    expect(pose.tip.y).toBeCloseTo(sim.player.position.y + Math.sin(pose.weaponAngle) * sweep.reach, 10);
  });

  it('remains deterministic across render-batch groupings', () => {
    const inputs = Array.from({ length: 80 }, (_, frame) => input({ aim: vectorAt(frame < 20 ? 0 : -0.4), light: frame === 2 }));
    const run = (batches: number[]) => {
      const sim = new CombatSimulation(); placeTarget(sim, 12 * Math.PI / 180); let cursor = 0;
      for (const batch of batches) for (let count = 0; count < batch && cursor < inputs.length; count += 1) sim.step(inputs[cursor++], aiIdle);
      return { player: sim.player, ai: sim.ai, events: sim.events, frame: sim.frame };
    };
    expect(run([80])).toEqual(run([1, 4, 9, 2, 17, 47]));
  });

  it('prevents duplicate hits for an assisted attack instance', () => {
    const sim = new CombatSimulation(); placeTarget(sim, 12 * Math.PI / 180); finishLight(sim);
    const hits = sim.events.filter((event) => event.type === 'hit' && event.actor === 'player');
    expect(hits).toHaveLength(1); expect(hits[0].attackInstanceId).toBe(1);
  });

  it('clears attack, motion, and feint state on restart while preserving fixed-tick authority', () => {
    const sim = new CombatSimulation(); placeTarget(sim, 12 * Math.PI / 180); sim.step(input({ light: true }), aiIdle);
    expect(facingAngle(sim.player.facing)).not.toBeCloseTo(0, 10);
    for (let frame = 0; frame < FEINT.earliestFrame; frame += 1) sim.step(idle, aiIdle);
    sim.step(input({ feint: true }), aiIdle);
    expect(sim.player.state).toBe('feintRecovery'); expect(sim.player.lastFeintKind).toBe('light');
    sim.restart();
    expect(sim.fixedHz).toBe(FIXED_HZ); expect(sim.player.state).toBe('idle'); expect(sim.player.attack).toBeNull();
    expect(sim.player.facing).toEqual({ x: 1, y: 0 }); expect(sim.player.attackInstanceId).toBe(0);
    expect(sim.player.feintCooldown).toBe(0); expect(sim.player.lastFeintKind).toBeNull();
    expect(sim.player.flashFrames).toBe(0); expect(sim.player.trailFrames).toBe(0); expect(combatPose(sim.player).animation).toBe('respawn');
  });
});
