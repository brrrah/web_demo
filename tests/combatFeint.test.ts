import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { ATTACKS, DODGE, FEINT, PARRY } from '../src/combatData';
import { combatPose } from '../src/combatMotion';

const input = (value: Partial<FighterInput>): FighterInput => ({ ...NO_INPUT, ...value, move: value.move ?? NO_INPUT.move, aim: value.aim ?? { x: 1, y: 0 } });
const idle = input({});
const aiIdle = input({ aim: { x: -1, y: 0 } });

function placeInRange(sim: CombatSimulation): void {
  sim.player.position = { x: 400, y: 300 }; sim.ai.position = { x: 470, y: 300 };
  sim.player.facing = { x: 1, y: 0 }; sim.ai.facing = { x: -1, y: 0 };
  sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
}

function advance(sim: CombatSimulation, frames: number, player = idle, ai = aiIdle): void {
  for (let frame = 0; frame < frames; frame += 1) sim.step(player, ai);
}

function enterLegalLightFeint(sim: CombatSimulation): void {
  sim.step(input({ light: true }), aiIdle);
  advance(sim, FEINT.earliestFrame);
  sim.step(input({ feint: true }), aiIdle);
}

describe('GAME-P0D deterministic feint and counterplay', () => {
  it('cancels only readable startup and creates no hit or sweep event', () => {
    const sim = new CombatSimulation(); placeInRange(sim); enterLegalLightFeint(sim);
    expect(sim.player.state).toBe('feintRecovery'); expect(sim.player.attack).toBeNull();
    expect(sim.events.filter((event) => event.type === 'feint')).toHaveLength(1);
    advance(sim, FEINT.recovery + 4);
    expect(sim.ai.hp).toBe(100); expect(sim.events.some((event) => event.type === 'hit' && event.actor === 'player')).toBe(false);
  });

  it('rejects too-early and post-commitment feint inputs', () => {
    const early = new CombatSimulation(); placeInRange(early); early.step(input({ light: true }), aiIdle); early.step(input({ feint: true }), aiIdle);
    expect(early.player.state).toBe('attack'); expect(early.events.some((event) => event.type === 'feint')).toBe(false);

    const committed = new CombatSimulation(); placeInRange(committed); committed.step(input({ light: true }), aiIdle);
    advance(committed, ATTACKS.light.startup - FEINT.commitmentBuffer);
    committed.step(input({ feint: true }), aiIdle); expect(committed.player.state).toBe('attack');
    advance(committed, ATTACKS.light.active + ATTACKS.light.recovery + 8);
    expect(committed.ai.hp).toBeLessThan(100); expect(committed.events.some((event) => event.type === 'feint')).toBe(false);
  });

  it('enforces explicit punishable recovery and cooldown cost', () => {
    const sim = new CombatSimulation(); placeInRange(sim); enterLegalLightFeint(sim);
    const position = { ...sim.player.position };
    advance(sim, FEINT.recovery - 1, input({ move: { x: 1, y: 0 }, light: true, feint: true }));
    expect(sim.player.state).toBe('feintRecovery'); expect(sim.player.position).toEqual(position); expect(sim.player.feintCooldown).toBeGreaterThan(0);
    sim.step(idle, aiIdle); expect(sim.player.state).toBe('idle'); expect(sim.player.feintCooldown).toBeGreaterThan(0);
  });

  it('allows the opponent to punish feint recovery with normal combat authority', () => {
    const sim = new CombatSimulation(); placeInRange(sim); enterLegalLightFeint(sim);
    sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
    for (let frame = 0; frame < ATTACKS.light.startup + ATTACKS.light.active + 3; frame += 1) sim.step(idle, aiIdle);
    expect(sim.player.hp).toBeLessThan(100); expect(sim.events.some((event) => event.type === 'hit' && event.actor === 'ai')).toBe(true);
  });

  it('preserves attack-instance identity across feint and the next real swing', () => {
    const sim = new CombatSimulation(); placeInRange(sim); enterLegalLightFeint(sim);
    const feint = sim.events.find((event) => event.type === 'feint')!; expect(feint.attackInstanceId).toBe(1);
    advance(sim, FEINT.recovery + FEINT.cooldown + 2);
    sim.step(input({ light: true }), aiIdle); advance(sim, ATTACKS.light.startup + ATTACKS.light.active + ATTACKS.light.recovery + 4);
    const hits = sim.events.filter((event) => event.type === 'hit' && event.actor === 'player');
    expect(hits).toHaveLength(1); expect(hits[0].attackInstanceId).toBe(2);
  });

  it('maps the cancelled windup into a readable return pose', () => {
    const sim = new CombatSimulation(); placeInRange(sim); sim.step(input({ heavy: true, delayHeavy: true }), aiIdle); advance(sim, FEINT.earliestFrame + 3);
    const windup = combatPose(sim.player); expect(windup.animation).toBe('heavyWindup');
    sim.step(input({ feint: true }), aiIdle); const start = combatPose(sim.player); expect(start.animation).toBe('feintRecovery');
    advance(sim, Math.floor(FEINT.recovery / 2)); const returning = combatPose(sim.player);
    expect(Math.abs(returning.weaponAngle - 0.4)).toBeLessThan(Math.abs(start.weaponAngle - 0.4));
  });

  it('remains deterministic across different render-batch groupings', () => {
    const inputs = Array.from({ length: 90 }, (_, frame) => input({ light: frame === 1, feint: frame === 7, move: frame > 30 && frame < 45 ? { x: 1, y: 0 } : { x: 0, y: 0 } }));
    const run = (batches: number[]) => {
      const sim = new CombatSimulation(); placeInRange(sim); let cursor = 0;
      for (const batch of batches) for (let count = 0; count < batch && cursor < inputs.length; count += 1) sim.step(inputs[cursor++], aiIdle);
      return { player: sim.player, aiHp: sim.ai.hp, events: sim.events, frame: sim.frame };
    };
    expect(run([90])).toEqual(run([3, 8, 1, 17, 6, 55]));
  });

  it('preserves P0A and P0C timing contracts', () => {
    expect(ATTACKS.light).toMatchObject({ startup: 12, active: 4, sweepStartAngle: -72 * Math.PI / 180, sweepEndAngle: 66 * Math.PI / 180 });
    expect(ATTACKS.heavy).toMatchObject({ startup: 24, active: 6, sweepStartAngle: -98 * Math.PI / 180, sweepEndAngle: 96 * Math.PI / 180 });
    expect(PARRY.active).toBe(3); expect(PARRY.attackerStun).toBe(60);
    expect(DODGE.invulnerable).toBe(8); expect(DODGE.charges).toBe(2); expect(DODGE.recharge).toBe(108);
  });
});