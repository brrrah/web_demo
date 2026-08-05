import { describe, expect, it } from 'vitest';
import { ARENA_BOUNDS, CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { ATTACKS, DODGE, GROUND_DASH, PARRY } from '../src/combatData';
import { combatPose, incomingContactTick } from '../src/combatMotion';
import { DASH_DIRECTIONS, DoubleTapDashDetector, PLAYER_GROUND_BINDINGS, type MoveKey } from '../src/groundInput';

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
  sim.player.spawnFrames = 0;
  sim.ai.spawnFrames = 0;
}

function placeInRange(sim: CombatSimulation, distance = 70): void {
  ready(sim);
  sim.player.position = { x: 400, y: 300 };
  sim.player.facing = { x: 1, y: 0 };
  sim.ai.position = { x: 400 + distance, y: 300 };
  sim.ai.facing = { x: -1, y: 0 };
}

function advance(sim: CombatSimulation, frames: number, player = idle, ai = aiIdle): void {
  for (let frame = 0; frame < frames; frame += 1) sim.step(player, ai);
}

function prepareIncomingLight(sim: CombatSimulation): void {
  placeInRange(sim);
  sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
  advance(sim, 10);
  expect(sim.ai.state).toBe('attack');
  expect(sim.ai.stateFrame).toBe(10);
}

function parryIncomingLight(sim: CombatSimulation): void {
  prepareIncomingLight(sim);
  sim.step(input({ light: true }), aiIdle);
  advance(sim, 2);
  expect(sim.events.some((event) => event.type === 'parry')).toBe(true);
}

describe('GAME-P0F ground input and unified blade action', () => {
  it('recognizes WW, SS, AA, and DD only after key-up inside the fixed ten-tick window', () => {
    for (const key of ['W', 'S', 'A', 'D'] as MoveKey[]) {
      const detector = new DoubleTapDashDetector();
      expect(detector.keyDown(key, 20)).toBeNull();
      expect(detector.keyDown(key, 21, true)).toBeNull();
      detector.keyUp(key);
      expect(detector.keyDown(key, 30)).toEqual(DASH_DIRECTIONS[key]);
    }
  });

  it('rejects OS repeat, held keys, mixed-key sequences, expired taps, and clears taps on reset', () => {
    const held = new DoubleTapDashDetector();
    expect(held.keyDown('D', 0)).toBeNull();
    expect(held.keyDown('D', 1)).toBeNull();
    expect(held.keyDown('D', 2, true)).toBeNull();

    const mixed = new DoubleTapDashDetector();
    mixed.keyDown('W', 0); mixed.keyUp('W');
    mixed.keyDown('A', 2); mixed.keyUp('A');
    expect(mixed.keyDown('W', 4)).toBeNull();

    const expired = new DoubleTapDashDetector();
    expired.keyDown('S', 0); expired.keyUp('S');
    expect(expired.keyDown('S', GROUND_DASH.doubleTapWindow + 1)).toBeNull();
    expired.keyUp('S'); expired.reset();
    expect(expired.keyDown('S', GROUND_DASH.doubleTapWindow + 2)).toBeNull();
  });

  it('keeps F and Z unbound while Space remains the invulnerable roll and Q remains feint', () => {
    expect(PLAYER_GROUND_BINDINGS).toEqual({ roll: 'SPACE', feint: 'Q', legacyParry: null, jump: null });
  });

  it('runs a six-tick non-resource ground dash in fixed screen direction with cooldown and arena clamping', () => {
    const sim = new CombatSimulation(); ready(sim);
    const start = { ...sim.player.position };
    sim.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    expect(sim.player.state).toBe('dash');
    expect(sim.player.velocity).toEqual({ x: GROUND_DASH.speed, y: 0 });
    expect(sim.player.dodgeCharges).toBe(DODGE.charges);
    advance(sim, GROUND_DASH.duration);
    expect(sim.player.state).toBe('idle');
    expect(sim.player.position.x).toBeCloseTo(start.x + GROUND_DASH.speed * GROUND_DASH.duration, 5);
    expect(sim.player.position.y).toBe(start.y);
    const afterDash = sim.player.position.x;
    sim.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    expect(sim.player.state).toBe('idle');
    expect(sim.player.position.x).toBe(afterDash);

    const wall = new CombatSimulation(); ready(wall);
    wall.player.position.x = ARENA_BOUNDS.maxX - 1;
    wall.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    advance(wall, 3);
    expect(wall.player.position.x).toBe(ARENA_BOUNDS.maxX);
  });

  it('does not grant invulnerability to the ground dash', () => {
    const sim = new CombatSimulation(); placeInRange(sim);
    sim.ai.state = 'attack';
    sim.ai.attack = 'light';
    sim.ai.stateFrame = ATTACKS.light.startup;
    sim.ai.attackInstanceId = 1;
    sim.step(input({ dash: { x: -1, y: 0 } }), aiIdle);
    expect(sim.player.state).toBe('hitstun');
    expect(sim.player.hp).toBe(100 - ATTACKS.light.damage);
  });

  it('preserves Space roll direction fallback, eight invulnerable ticks, charges, recharge, and active-input lock', () => {
    const sim = new CombatSimulation(); ready(sim);
    sim.step(input({ move: { x: 0, y: -1 } }), aiIdle);
    sim.step(input({ dodge: true }), aiIdle);
    expect(sim.player.state).toBe('dodge');
    expect(sim.player.velocity.y).toBeLessThan(0);
    expect(sim.player.dodgeCharges).toBe(1);
    sim.step(input({ dodge: true, move: { x: 1, y: 0 } }), aiIdle);
    expect(sim.player.dodgeCharges).toBe(1);
    expect(DODGE.invulnerable).toBe(8);
    expect(DODGE.recharge).toBe(90);

    const facingFallback = new CombatSimulation(); ready(facingFallback);
    facingFallback.player.facing = { x: -1, y: 0 };
    facingFallback.step(input({ dodge: true, move: { x: 0, y: 0 }, aim: { x: -1, y: 0 } }), aiIdle);
    expect(facingFallback.player.velocity.x).toBeLessThan(0);
  });

  it('applies roll before LMB, LMB before heavy or dash, and heavy before dash', () => {
    const roll = new CombatSimulation(); ready(roll);
    roll.step(input({ dodge: true, light: true, heavy: true, dash: { x: 1, y: 0 }, move: { x: -1, y: 0 } }), aiIdle);
    expect(roll.player.state).toBe('dodge');

    const blade = new CombatSimulation(); ready(blade);
    blade.step(input({ light: true, heavy: true, dash: { x: 1, y: 0 } }), aiIdle);
    expect(blade.player.state).toBe('attack');
    expect(blade.player.attack).toBe('light');
    expect(blade.player.bladeInterceptFrames).toBe(PARRY.active);

    const heavy = new CombatSimulation(); ready(heavy);
    heavy.step(input({ heavy: true, dash: { x: 1, y: 0 } }), aiIdle);
    expect(heavy.player.state).toBe('attack');
    expect(heavy.player.attack).toBe('heavy');
  });

  it('shows exactly three fixed intercept ticks, rejects refresh spam, then continues the unchanged light timeline', () => {
    const sim = new CombatSimulation(); ready(sim);
    sim.ai.position = { x: 700, y: 300 };
    sim.step(input({ light: true }), aiIdle);
    const remaining = [combatPose(sim.player).parryTicksRemaining];
    for (let tick = 0; tick < PARRY.active; tick += 1) {
      sim.step(input({ light: true }), aiIdle);
      remaining.push(combatPose(sim.player).parryTicksRemaining);
    }
    expect(remaining).toEqual([3, 2, 1, 0]);
    expect(combatPose(sim.player).parryActive).toBe(false);
    expect(sim.player.stateFrame).toBe(PARRY.active);
    expect(sim.player.attack).toBe('light');

    advance(sim, ATTACKS.light.startup - sim.player.stateFrame);
    expect(sim.attackPhase(sim.player)).toBe('active');
    expect(sim.player.stateFrame).toBe(ATTACKS.light.startup);
    advance(sim, ATTACKS.light.active + ATTACKS.light.recovery);
    expect(sim.player.state).toBe('idle');
    expect(sim.player.lastBladeActionResult).toBe('WHIFF');
  });

  it('parries a real incoming swept contact inside the LMB window without also producing an attack', () => {
    const sim = new CombatSimulation();
    prepareIncomingLight(sim);
    expect(incomingContactTick(sim.ai, sim.player, sim.frame)).toBe(sim.frame + 3);
    sim.step(input({ light: true }), aiIdle);
    expect(sim.parryPhase(sim.player)).toBe('active');
    expect(combatPose(sim.player).animation).toBe('bladeIntercept');
    advance(sim, 2);
    const parry = sim.events.find((event) => event.type === 'parry');
    expect(parry?.contactActiveTick).toBe(1);
    expect(sim.player.hp).toBe(100);
    expect(sim.player.attack).toBeNull();
    expect(sim.player.lastBladeActionResult).toBe('PARRY');
    expect(sim.ai.state).toBe('parried');
    expect(sim.ai.stateFrame).toBe(PARRY.attackerStun);
  });

  it('separates early and late outcomes: a feint bait commits to a whiffable light, while a late click is blocked by hitstun', () => {
    const bait = new CombatSimulation(); placeInRange(bait, 120);
    bait.step(idle, input({ heavy: true, delayHeavy: true, aim: { x: -1, y: 0 } }));
    advance(bait, 4);
    bait.step(input({ light: true }), input({ feint: true, aim: { x: -1, y: 0 } }));
    expect(bait.events.some((event) => event.type === 'feint')).toBe(true);
    advance(bait, PARRY.active);
    expect(bait.player.state).toBe('attack');
    expect(bait.player.attack).toBe('light');
    bait.step(input({ dodge: true }), aiIdle);
    expect(bait.player.state).toBe('attack');
    advance(bait, ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery);
    expect(bait.player.lastBladeActionResult).toBe('WHIFF');

    const late = new CombatSimulation(); prepareIncomingLight(late);
    advance(late, 3);
    expect(late.player.hp).toBeLessThan(100);
    advance(late, late.hitstopFrames);
    late.step(input({ light: true }), aiIdle);
    expect(late.player.state).toBe('hitstun');
    expect(late.player.lastBladeActionResult).toBe('BLOCKED');
  });

  it('allows only the specified ground-dash cancels and preserves hit-confirm requirements', () => {
    const dashToBlade = new CombatSimulation(); ready(dashToBlade);
    dashToBlade.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    dashToBlade.step(input({ light: true }), aiIdle);
    expect(dashToBlade.player.state).toBe('attack');
    expect(dashToBlade.player.bladeInterceptFrames).toBe(PARRY.active);

    const parryToDash = new CombatSimulation();
    parryIncomingLight(parryToDash);
    advance(parryToDash, 4);
    parryToDash.step(input({ dash: { x: -1, y: 0 } }), aiIdle);
    expect(parryToDash.player.state).toBe('dash');

    const confirm = new CombatSimulation(); ready(confirm);
    confirm.player.state = 'attack'; confirm.player.attack = 'light';
    confirm.player.stateFrame = ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery / 2;
    confirm.player.hitTargets = ['ai'];
    confirm.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    expect(confirm.player.state).toBe('dash');

    const whiff = new CombatSimulation(); ready(whiff);
    whiff.player.state = 'attack'; whiff.player.attack = 'light';
    whiff.player.stateFrame = ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery / 2;
    whiff.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    expect(whiff.player.state).toBe('attack');
  });

  it('resets dash, blade, pose, and tap state and remains deterministic across render batching', () => {
    const detector = new DoubleTapDashDetector();
    detector.keyDown('W', 1); detector.keyUp('W'); detector.reset();
    expect(detector.keyDown('W', 2)).toBeNull();

    const reset = new CombatSimulation(); ready(reset);
    reset.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    reset.step(input({ light: true }), aiIdle);
    for (let count = 0; count < 10; count += 1) reset.restart();
    expect(reset.player.state).toBe('idle');
    expect(reset.player.dashCooldown).toBe(0);
    expect(reset.player.bladeInterceptFrames).toBe(0);
    expect(reset.player.lastBladeActionResult).toBe('NONE');
    expect(combatPose(reset.player).parryActive).toBe(false);

    const run = (batches: number[]) => {
      const sim = new CombatSimulation(); ready(sim);
      const stream = Array.from({ length: 80 }, (_, tick) => input({
        move: tick < 3 ? { x: 0, y: -1 } : { x: 0, y: 0 },
        dash: tick === 3 ? { x: 0, y: -1 } : null,
        light: tick === 12,
      }));
      let cursor = 0;
      for (const batch of batches) for (let count = 0; count < batch && cursor < stream.length; count += 1) sim.step(stream[cursor++], aiIdle);
      return {
        frame: sim.frame,
        position: sim.player.position,
        hp: sim.ai.hp,
        state: sim.player.state,
        result: sim.player.lastBladeActionResult,
        events: sim.events.map((event) => ({ type: event.type, frame: event.frame })),
      };
    };
    expect(run([80])).toEqual(run([1, 2, 7, 3, 19, 48]));
  });
});
