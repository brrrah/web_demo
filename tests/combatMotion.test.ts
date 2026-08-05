import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, type Fighter, type FighterInput } from '../src/combat';
import { ATTACKS, PARRY } from '../src/combatData';
import { activeWeaponSweep, attackTimeline, combatPose, expectedContactActiveTick, facingAngle, normalizeAngle, type MotionState } from '../src/combatMotion';

const input = (value: Partial<FighterInput>): FighterInput => ({ ...NO_INPUT, ...value, move: value.move ?? NO_INPUT.move, aim: value.aim ?? { x: 1, y: 0 } });
const idle = input({});
const aiIdle = input({ aim: { x: -1, y: 0 } });

function fighter(overrides: Partial<Fighter> = {}): Fighter {
  return {
    id: 'player', position: { x: 300, y: 300 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, hp: 100,
    state: 'idle', stateFrame: 0, attack: null, attackDelay: 0, attackInstanceId: 0, hitTargets: [],
    parrySuccessFrames: 0, spawnFrames: 0, feintCooldown: 0, lastFeintKind: null, parryCooldown: 0, dodgeCooldown: 0, dodgeCharges: 2,
    dodgeRecharge: 0, dashCooldown: 0, lastMoveDirection: null, bladeInterceptFrames: 0,
    lastBladeActionResult: 'NONE', lastBladeInputFrame: null, lastParrySuccessFrame: null, lastParryFailFrame: null,
    attackForwardMomentum: 0, flashFrames: 0, trailFrames: 0, ...overrides,
  };
}

function placeTarget(sim: CombatSimulation, angle: number, distance = 70): void {
  sim.player.position = { x: 400, y: 300 }; sim.player.facing = { x: 1, y: 0 };
  sim.ai.position = { x: 400 + Math.cos(angle) * distance, y: 300 + Math.sin(angle) * distance };
  sim.ai.facing = { x: -1, y: 0 };
  sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
}

function finishAttack(sim: CombatSimulation, kind: 'light' | 'heavy', delayHeavy = false): void {
  sim.step(input({ light: kind === 'light', heavy: kind === 'heavy', delayHeavy }), aiIdle);
  const frames = ATTACKS[kind].startup + (delayHeavy ? 8 : 0) + ATTACKS[kind].active + ATTACKS[kind].recovery + 8;
  for (let frame = 0; frame < frames; frame += 1) sim.step(idle, aiIdle);
}

describe('GAME-P0C combat motion authority', () => {
  it('maps combat states to distinct readable procedural poses', () => {
    const light = combatPose(fighter({ state: 'attack', attack: 'light', stateFrame: ATTACKS.light.startup - 1 }));
    const heavy = combatPose(fighter({ state: 'attack', attack: 'heavy', stateFrame: ATTACKS.heavy.startup - 1 }));
    expect(light.animation).toBe('lightWindup'); expect(heavy.animation).toBe('heavyWindup');
    expect(Math.abs(light.weaponAngle - heavy.weaponAngle)).toBeGreaterThan(0.4);
    expect(heavy.weaponLength).toBeGreaterThan(light.weaponLength);
    const mappings: Array<[Partial<Fighter>, MotionState]> = [
      [{ velocity: { x: 2, y: 0 } }, 'move'],
      [{ state: 'dodge', stateFrame: 2, velocity: { x: 4, y: 0 } }, 'dodge'],
      [{ state: 'hitstun', stateFrame: 5 }, 'hitstun'],
      [{ state: 'parried', stateFrame: 24 }, 'parried'],
      [{ state: 'dead' }, 'dead'],
      [{ spawnFrames: 12 }, 'respawn'],
    ];
    for (const [source, expected] of mappings) expect(combatPose(fighter(source)).animation).toBe(expected);
  });

  it('holds delayed heavy windup and cannot enter active before release timeline', () => {
    const held = fighter({ state: 'attack', attack: 'heavy', attackDelay: 8, stateFrame: ATTACKS.heavy.startup });
    expect(attackTimeline(held)?.phase).toBe('startup'); expect(combatPose(held).animation).toBe('heavyHold'); expect(activeWeaponSweep(held)).toBeNull();
    held.stateFrame = ATTACKS.heavy.startup + 7; expect(attackTimeline(held)?.phase).toBe('startup');
    held.stateFrame += 1; expect(attackTimeline(held)?.phase).toBe('active'); expect(activeWeaponSweep(held)?.activeTick).toBe(0);
  });

  it('uses the same tick angles for pose tips and simulation sweep', () => {
    for (const kind of ['light', 'heavy'] as const) {
      for (let tick = 0; tick < ATTACKS[kind].active; tick += 1) {
        const source = fighter({ state: 'attack', attack: kind, stateFrame: ATTACKS[kind].startup + tick });
        const pose = combatPose(source); const sweep = activeWeaponSweep(source)!; const base = facingAngle(source.facing);
        expect(normalizeAngle(pose.weaponAngle - base)).toBeCloseTo(sweep.currentAngle, 8);
        expect(normalizeAngle(pose.previousWeaponAngle - base)).toBeCloseTo(sweep.previousAngle, 8);
        expect(Math.hypot(pose.tip.x - source.position.x, pose.tip.y - source.position.y)).toBeCloseTo(sweep.reach, 8);
      }
    }
  });

  it('hits inside the forward swept arc but misses side-outside, rear, and out-of-range targets', () => {
    const front = new CombatSimulation(); placeTarget(front, 0); finishAttack(front, 'light'); expect(front.ai.hp).toBeLessThan(100);
    const side = new CombatSimulation(); placeTarget(side, Math.PI * 0.72); finishAttack(side, 'light'); expect(side.ai.hp).toBe(100);
    const rear = new CombatSimulation(); placeTarget(rear, Math.PI); finishAttack(rear, 'heavy'); expect(rear.ai.hp).toBe(100);
    const far = new CombatSimulation(); placeTarget(far, 0, ATTACKS.heavy.reach + 30); finishAttack(far, 'heavy'); expect(far.ai.hp).toBe(100);
  });

  it('aligns predicted visual contact tick with hit adjudication and prevents duplicate hits', () => {
    const sim = new CombatSimulation(); placeTarget(sim, 0);
    const expected = expectedContactActiveTick('light', 0, 70); expect(expected).not.toBeNull();
    finishAttack(sim, 'light');
    const hits = sim.events.filter((event) => event.type === 'hit' && event.actor === 'player');
    expect(hits).toHaveLength(1); expect(hits[0].contactActiveTick).toBe(expected); expect(hits[0].attackInstanceId).toBe(1);
  });

  it('delays heavy visual contact and hit by the same eight fixed ticks', () => {
    const normal = new CombatSimulation(); placeTarget(normal, 0); normal.step(input({ heavy: true }), aiIdle);
    while (!normal.events.some((event) => event.type === 'hit')) normal.step(idle, aiIdle);
    const delayed = new CombatSimulation(); placeTarget(delayed, 0); delayed.step(input({ heavy: true, delayHeavy: true }), aiIdle);
    while (!delayed.events.some((event) => event.type === 'hit')) delayed.step(idle, aiIdle);
    const normalHit = normal.events.find((event) => event.type === 'hit')!; const delayedHit = delayed.events.find((event) => event.type === 'hit')!;
    expect(delayedHit.frame - normalHit.frame).toBe(8);
    expect(delayedHit.contactActiveTick).toBe(normalHit.contactActiveTick);
  });

  it('aligns parry contact tick and keeps success/early/late poses distinct', () => {
    const predicted = expectedContactActiveTick('light', 0, 70)!;
    const success = new CombatSimulation(); placeTarget(success, 0); success.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
    const beforeParry = ATTACKS.light.startup + predicted - PARRY.startup - 1;
    for (let frame = 0; frame < beforeParry; frame += 1) success.step(idle, aiIdle);
    success.step(input({ parry: true }), aiIdle);
    while (!success.events.some((event) => event.type === 'parry')) success.step(idle, aiIdle);
    const parry = success.events.find((event) => event.type === 'parry')!;
    expect(parry.contactActiveTick).toBe(predicted); expect(combatPose(success.player).animation).toBe('parrySuccess'); expect(combatPose(success.ai).animation).toBe('parried');

    const earlyPose = combatPose(fighter({ state: 'parry', stateFrame: PARRY.startup + PARRY.active + 4 }));
    const latePose = combatPose(fighter({ state: 'hitstun', stateFrame: 8 }));
    expect(earlyPose.animation).toBe('parryRecovery'); expect(latePose.animation).toBe('hitstun');
    expect(earlyPose.weaponAngle).not.toBeCloseTo(latePose.weaponAngle, 2);
  });

  it('resets animation ownership and FX on restart', () => {
    const sim = new CombatSimulation(); sim.player.state = 'parried'; sim.player.stateFrame = 12; sim.player.attack = 'heavy';
    sim.player.attackDelay = 8; sim.player.hitTargets = ['ai']; sim.player.flashFrames = 4; sim.player.trailFrames = 3; sim.player.parrySuccessFrames = 5;
    sim.restart();
    expect(sim.player.state).toBe('idle'); expect(sim.player.attack).toBeNull(); expect(sim.player.hitTargets).toEqual([]);
    expect(sim.player.flashFrames).toBe(0); expect(sim.player.trailFrames).toBe(0); expect(sim.player.parrySuccessFrames).toBe(0);
    expect(combatPose(sim.player).animation).toBe('respawn');
  });
});