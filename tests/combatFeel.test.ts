import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, type CombatEvent, type FighterInput } from '../src/combat';
import { ATTACKS, DODGE, FEINT, GROUND_DASH, HIT_FEEDBACK, MOVEMENT, PARRY } from '../src/combatData';
import { combatPose } from '../src/combatMotion';
import { TELEGRAPH_COUNTDOWN_TICKS, predictAttackTelegraph } from '../src/combatTelegraph';

const input = (value: Partial<FighterInput> = {}): FighterInput => ({
  ...NO_INPUT,
  ...value,
  move: value.move ?? NO_INPUT.move,
  aim: value.aim ?? { x: 1, y: 0 },
  dash: value.dash ?? null,
});
const idle = input();
const aiIdle = input({ aim: { x: -1, y: 0 } });

function place(sim: CombatSimulation, distance = 70): void {
  sim.player.spawnFrames = 0;
  sim.ai.spawnFrames = 0;
  sim.player.position = { x: 400, y: 300 };
  sim.player.facing = { x: 1, y: 0 };
  sim.ai.position = { x: 400 + distance, y: 300 };
  sim.ai.facing = { x: -1, y: 0 };
}

function advance(sim: CombatSimulation, frames: number, player = idle, ai = aiIdle): void {
  for (let frame = 0; frame < frames; frame += 1) sim.step(player, ai);
}

function startIncoming(sim: CombatSimulation, kind: 'light' | 'heavy', delayed = false): void {
  place(sim);
  sim.step(idle, input({ heavy: kind === 'heavy', light: kind === 'light', delayHeavy: delayed, aim: { x: -1, y: 0 } }));
}

function runToContact(sim: CombatSimulation): { event: CombatEvent; countdowns: number[]; promptTicks: number[] } {
  const countdowns: number[] = [];
  const promptTicks: number[] = [];
  for (let guard = 0; guard < 80; guard += 1) {
    const telegraph = predictAttackTelegraph(sim.ai, sim.player, sim.frame);
    if (telegraph.ringActive) countdowns.push(telegraph.countdownTicks!);
    if (telegraph.promptActive) promptTicks.push(telegraph.countdownTicks!);
    sim.step(idle, aiIdle);
    const event = sim.events.find((candidate) => (candidate.type === 'hit' || candidate.type === 'parry') && candidate.actor === 'ai');
    if (event) return { event, countdowns, promptTicks };
  }
  throw new Error('contact not reached');
}

function forceIncomingLightAtRollFrame(stateFrame: number): CombatSimulation {
  const sim = new CombatSimulation();
  place(sim);
  sim.player.state = 'dodge';
  sim.player.stateFrame = stateFrame;
  sim.player.velocity = { x: 0, y: 0 };
  sim.player.dodgeCharges = 1;
  sim.ai.state = 'attack';
  sim.ai.attack = 'light';
  sim.ai.stateFrame = ATTACKS.light.startup;
  sim.ai.attackInstanceId = 1;
  sim.step(input({ light: true, heavy: true, dodge: true, dash: { x: 1, y: 0 } }), aiIdle);
  return sim;
}

describe('GAME-P0G combat telegraph, roll, and kinetic feel', () => {
  it('derives a yellow sweep, exact six-tick ring, LMB cue, and white-tip cue from the future real contact', () => {
    const sim = new CombatSimulation(); startIncoming(sim, 'light');
    const initial = predictAttackTelegraph(sim.ai, sim.player, sim.frame);
    expect(initial.active).toBe(true);
    expect(initial.yellowArcActive).toBe(true);
    expect(initial.predictedContactTick).not.toBeNull();
    expect(initial.predictedContactPoint).not.toBeNull();

    const result = runToContact(sim);
    expect(result.countdowns).toEqual([6, 5, 4, 3, 2, 1]);
    expect(result.promptTicks).toEqual([1]);
    expect(result.event.frame).toBe(initial.predictedContactTick);
    expect(result.event.contactX).toBeCloseTo(initial.predictedContactPoint!.x, 8);
    expect(result.event.contactY).toBeCloseTo(initial.predictedContactPoint!.y, 8);
    expect(TELEGRAPH_COUNTDOWN_TICKS).toBe(6);
  });

  it('moves delayed-heavy contact and every advisory cue by the same eight authoritative ticks', () => {
    const normal = new CombatSimulation(); startIncoming(normal, 'heavy', false);
    const delayed = new CombatSimulation(); startIncoming(delayed, 'heavy', true);
    const normalCue = predictAttackTelegraph(normal.ai, normal.player, normal.frame);
    const delayedCue = predictAttackTelegraph(delayed.ai, delayed.player, delayed.frame);
    expect(normalCue.active).toBe(true);
    expect(delayedCue.active).toBe(true);
    expect(delayedCue.predictedContactTick! - normalCue.predictedContactTick!).toBe(8);
    expect(runToContact(delayed).event.frame - runToContact(normal).event.frame).toBe(8);
  });

  it('removes advisory output immediately on feint, cancellation, and range exit without changing combat authority', () => {
    const feint = new CombatSimulation(); startIncoming(feint, 'heavy', true);
    expect(predictAttackTelegraph(feint.ai, feint.player, feint.frame).active).toBe(true);
    advance(feint, FEINT.earliestFrame);
    feint.step(idle, input({ feint: true, aim: { x: -1, y: 0 } }));
    expect(feint.events.some((event) => event.type === 'feint')).toBe(true);
    expect(predictAttackTelegraph(feint.ai, feint.player, feint.frame).active).toBe(false);

    const cancelled = new CombatSimulation(); startIncoming(cancelled, 'light');
    cancelled.ai.state = 'idle'; cancelled.ai.attack = null;
    expect(predictAttackTelegraph(cancelled.ai, cancelled.player, cancelled.frame).active).toBe(false);

    const out = new CombatSimulation(); startIncoming(out, 'light');
    out.player.position.x = 100;
    expect(predictAttackTelegraph(out.ai, out.player, out.frame).active).toBe(false);

    const wrongDirection = new CombatSimulation(); startIncoming(wrongDirection, 'light');
    wrongDirection.ai.facing = { x: 1, y: 0 };
    expect(predictAttackTelegraph(wrongDirection.ai, wrongDirection.player, wrongDirection.frame).active).toBe(false);

    for (const state of ['dodge', 'hitstun', 'dead'] as const) {
      const interrupted = new CombatSimulation(); startIncoming(interrupted, 'light');
      interrupted.player.state = state;
      expect(predictAttackTelegraph(interrupted.ai, interrupted.player, interrupted.frame).active).toBe(false);
    }
    out.restart();
    expect(predictAttackTelegraph(out.ai, out.player, out.frame).active).toBe(false);
  });

  it('keeps telegraph observation advisory-only and deterministic across render batching', () => {
    const replay = (batches: number[], inspect: boolean) => {
      const sim = new CombatSimulation(); startIncoming(sim, 'heavy', true);
      const countdowns: Array<number | null> = [];
      let cursor = 0;
      for (const batch of batches) {
        for (let count = 0; count < batch && cursor < 70; count += 1) {
          if (inspect) countdowns.push(predictAttackTelegraph(sim.ai, sim.player, sim.frame).countdownTicks);
          sim.step(idle, aiIdle); cursor += 1;
        }
      }
      return { hp: sim.player.hp, frame: sim.frame, events: sim.events, aiState: sim.ai.state, countdowns };
    };
    const observedSingle = replay([70], true);
    const observedBatched = replay([1, 2, 7, 4, 16, 40], true);
    const unobserved = replay([70], false);
    expect(observedSingle).toEqual(observedBatched);
    expect({ ...observedSingle, countdowns: [] }).toEqual(unobserved);
  });

  it('makes exactly the central eight roll ticks invulnerable while startup and landing remain punishable', () => {
    const startup = forceIncomingLightAtRollFrame(0);
    expect(startup.player.hp).toBe(100 - ATTACKS.light.damage);
    expect(startup.player.state).toBe('hitstun');

    const invulnerable = forceIncomingLightAtRollFrame(DODGE.startup - 1);
    expect(invulnerable.rollPhase(invulnerable.player)).toBe('rollInvulnerable');
    expect(invulnerable.player.hp).toBe(100);
    expect(invulnerable.events.some((event) => event.type === 'hit')).toBe(false);

    const landing = forceIncomingLightAtRollFrame(DODGE.startup + DODGE.invulnerable - 1);
    expect(landing.player.state).toBe('hitstun');
    expect(landing.player.hp).toBe(100 - ATTACKS.light.damage);
  });

  it('runs rollStartup, eight rotated tuck ticks, and rollLanding while locking every active action', () => {
    const sim = new CombatSimulation(); place(sim, 250);
    sim.step(input({ dodge: true, move: { x: 0, y: -1 } }), aiIdle);
    const phases: string[] = [];
    const invulnerable: boolean[] = [];
    const rotations: number[] = [];
    for (let frame = 0; frame < DODGE.duration; frame += 1) {
      const pose = combatPose(sim.player);
      phases.push(pose.rollPhase);
      invulnerable.push(pose.rollInvulnerable);
      rotations.push(pose.rollRotation);
      expect(pose.rollPhase).toBe(sim.rollPhase(sim.player));
      sim.step(frame === 0 ? input({ light: true, heavy: true, dodge: true, dash: { x: 1, y: 0 }, feint: true }) : idle, aiIdle);
    }
    expect(phases.filter((phase) => phase === 'rollStartup')).toHaveLength(DODGE.startup);
    expect(phases.filter((phase) => phase === 'rollInvulnerable')).toHaveLength(8);
    expect(phases.filter((phase) => phase === 'rollLanding')).toHaveLength(DODGE.landing);
    expect(invulnerable.filter(Boolean)).toHaveLength(8);
    expect(Math.max(...rotations)).toBeGreaterThan(Math.PI * 1.5);
    expect(sim.player.state).toBe('idle');
    expect(sim.player.dodgeCharges).toBe(1);
    expect(sim.player.lastBladeActionResult).toBe('BLOCKED');
    expect(sim.events.filter((event) => event.type === 'dodge')).toHaveLength(1);
    expect(sim.events.some((event) => event.type === 'dash')).toBe(false);
  });

  it('keeps the red overlay contract identical to the true three-tick blade intercept for both palettes and clears it', () => {
    const sim = new CombatSimulation(); place(sim, 250);
    sim.step(input({ light: true }), aiIdle);
    const remaining = [combatPose(sim.player).parryTicksRemaining];
    const active = [combatPose(sim.player).parryActive];
    for (let frame = 0; frame < PARRY.active; frame += 1) {
      sim.step(input({ light: true }), aiIdle);
      remaining.push(combatPose(sim.player).parryTicksRemaining);
      active.push(combatPose(sim.player).parryActive);
    }
    expect(remaining).toEqual([3, 2, 1, 0]);
    expect(active).toEqual([true, true, true, false]);
    sim.ai.state = 'attack'; sim.ai.attack = 'light'; sim.ai.bladeInterceptFrames = 3;
    expect(combatPose(sim.ai).parryActive).toBe(true);
    sim.restart();
    expect(combatPose(sim.player).parryActive).toBe(false);
    expect(combatPose(sim.ai).parryActive).toBe(false);
  });

  it('gives ground movement immediate response, bounded diagonal speed, and two-tick release braking', () => {
    const sim = new CombatSimulation(); place(sim, 250);
    sim.step(input({ move: { x: 1, y: 0 } }), aiIdle);
    expect(sim.player.velocity.x).toBe(MOVEMENT.speedX);
    expect(sim.player.velocity.y).toBe(0);
    sim.step(idle, aiIdle);
    expect(sim.player.velocity.x).toBeCloseTo(MOVEMENT.speedX - MOVEMENT.deceleration, 8);
    sim.step(idle, aiIdle);
    expect(sim.player.velocity.x).toBe(0);

    const diagonal = new CombatSimulation(); place(diagonal, 250);
    diagonal.step(input({ move: { x: 1, y: 1 } }), aiIdle);
    expect(diagonal.player.velocity.x).toBeCloseTo(MOVEMENT.speedX / Math.SQRT2, 8);
    expect(diagonal.player.velocity.y).toBeCloseTo(MOVEMENT.speedY / Math.SQRT2, 8);
  });

  it('improves the non-invulnerable dash silhouette and distance without consuming roll resources', () => {
    const sim = new CombatSimulation(); place(sim, 250);
    const startX = sim.player.position.x;
    sim.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    const pose = combatPose(sim.player);
    expect(pose.animation).toBe('dash');
    expect(pose.lean).toBeGreaterThan(0.5);
    expect(sim.isRollInvulnerable(sim.player)).toBe(false);
    expect(sim.player.dodgeCharges).toBe(DODGE.charges);
    advance(sim, GROUND_DASH.duration);
    expect(sim.player.position.x - startX).toBeCloseTo(GROUND_DASH.speed * GROUND_DASH.duration, 8);
  });

  it('adds deterministic light/heavy forward commitment, preserves whiff recovery, and sharpens contact feedback', () => {
    const travel = (kind: 'light' | 'heavy') => {
      const sim = new CombatSimulation(); place(sim, 300);
      const startX = sim.player.position.x;
      sim.step(input({ light: kind === 'light', heavy: kind === 'heavy' }), aiIdle);
      advance(sim, ATTACKS[kind].startup + ATTACKS[kind].active + ATTACKS[kind].recovery);
      return sim.player.position.x - startX;
    };
    expect(travel('light')).toBeCloseTo(ATTACKS.light.forwardDistance, 8);
    expect(travel('heavy')).toBeCloseTo(ATTACKS.heavy.forwardDistance, 8);
    expect(ATTACKS.heavy.forwardDistance).toBeGreaterThan(ATTACKS.light.forwardDistance);

    const whiff = new CombatSimulation(); place(whiff, 300);
    whiff.step(input({ light: true }), aiIdle);
    advance(whiff, ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery / 2);
    whiff.step(input({ dash: { x: 1, y: 0 } }), aiIdle);
    expect(whiff.player.state).toBe('attack');

    const contact = (kind: 'light' | 'heavy') => {
      const sim = new CombatSimulation(); place(sim);
      sim.step(input({ light: kind === 'light', heavy: kind === 'heavy' }), aiIdle);
      for (let guard = 0; guard < 50 && !sim.events.some((event) => event.type === 'hit'); guard += 1) sim.step(idle, aiIdle);
      return { hitstop: sim.hitstopFrames, flash: sim.ai.flashFrames, knockback: Math.hypot(sim.ai.velocity.x, sim.ai.velocity.y) };
    };
    const light = contact('light');
    const heavy = contact('heavy');
    expect(light.hitstop).toBe(HIT_FEEDBACK.lightHitstop);
    expect(heavy.hitstop).toBe(HIT_FEEDBACK.heavyHitstop);
    expect(light.flash).toBe(HIT_FEEDBACK.flashTicks);
    expect(heavy.flash).toBe(HIT_FEEDBACK.flashTicks);
    expect(heavy.knockback).toBeGreaterThan(light.knockback);
  });
  it('replays telegraph to LMB parry to one-second stun and a real counter', () => {
    const sim = new CombatSimulation(); startIncoming(sim, 'light');
    let cueTick: number | null = null;
    let predictedTick: number | null = null;
    for (let guard = 0; guard < 40; guard += 1) {
      const cue = predictAttackTelegraph(sim.ai, sim.player, sim.frame);
      if (cue.promptActive) {
        cueTick = sim.frame;
        predictedTick = cue.predictedContactTick;
        sim.step(input({ light: true }), aiIdle);
        break;
      }
      sim.step(idle, aiIdle);
    }
    const parry = sim.events.find((event) => event.type === 'parry' && event.actor === 'player');
    expect(cueTick).not.toBeNull();
    expect(parry?.frame).toBe(predictedTick);
    expect(sim.player.hp).toBe(100);
    expect(sim.ai.state).toBe('parried');
    expect(sim.ai.stateFrame).toBe(PARRY.attackerStun);
    expect(sim.ai.hp).toBe(100);

    advance(sim, HIT_FEEDBACK.parryHitstop + PARRY.counterRecovery);
    expect(sim.player.state).toBe('idle');
    expect(sim.ai.state).toBe('parried');
    sim.step(input({ light: true }), aiIdle);
    for (let guard = 0; guard < 24 && sim.ai.hp === 100; guard += 1) sim.step(idle, aiIdle);
    expect(sim.ai.hp).toBe(100 - ATTACKS.light.damage);
  });

  it('replays heavy telegraph cleanup into an early blade whiff and recovery punish', () => {
    const sim = new CombatSimulation();
    place(sim, 116);
    sim.step(idle, input({ heavy: true, delayHeavy: true, aim: { x: -1, y: 0 } }));
    expect(predictAttackTelegraph(sim.ai, sim.player, sim.frame).active).toBe(true);
    advance(sim, FEINT.earliestFrame);
    sim.step(input({ light: true }), input({ feint: true, aim: { x: -1, y: 0 } }));
    expect(predictAttackTelegraph(sim.ai, sim.player, sim.frame).active).toBe(false);
    expect(sim.events.some((event) => event.type === 'feint')).toBe(true);

    advance(sim, FEINT.recovery);
    expect(sim.attackPhase(sim.player)).toBe('recovery');
    expect(sim.ai.state).toBe('idle');
    expect(sim.ai.hp).toBe(100);
    sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
    for (let guard = 0; guard < 24 && sim.player.hp === 100; guard += 1) sim.step(idle, aiIdle);
    expect(sim.player.hp).toBe(100 - ATTACKS.light.damage);
    expect(sim.events.some((event) => event.type === 'hit' && event.actor === 'ai')).toBe(true);
  });
});