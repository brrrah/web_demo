import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { ATTACKS, PARRY } from '../src/combatData';
import { combatPose } from '../src/combatMotion';
import { predictAttackTelegraph } from '../src/combatTelegraph';
import { PARRY_READABILITY, parryCueStyle } from '../src/presentationData';

const input = (value: Partial<FighterInput> = {}): FighterInput => ({
  ...NO_INPUT,
  ...value,
  move: value.move ?? NO_INPUT.move,
  aim: value.aim ?? { x: 1, y: 0 },
  dash: value.dash ?? null,
});
const idle = input();
const aiIdle = input({ aim: { x: -1, y: 0 } });

function incomingLight(): CombatSimulation {
  const sim = new CombatSimulation();
  sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
  sim.player.position = { x: 400, y: 300 }; sim.player.facing = { x: 1, y: 0 };
  sim.ai.position = { x: 470, y: 300 }; sim.ai.facing = { x: -1, y: 0 };
  sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
  return sim;
}

describe('user-authorized parry visibility reinforcement', () => {
  it('maps the six contact ticks to large fixed-screen countdown instructions', () => {
    expect(parryCueStyle(true, 6, true)?.label).toBe('6');
    expect(parryCueStyle(true, 4, true)?.label).toBe('4');
    expect(parryCueStyle(true, 3, true)?.label).toBe('READY 3');
    expect(parryCueStyle(true, 2, true)?.label).toBe('READY 2');
    expect(parryCueStyle(true, 1, true)?.label).toBe('LMB!');
    expect(parryCueStyle(false, null, true)).toBeNull();
    expect(parryCueStyle(true, 1, false)).toBeNull();
  });

  it('uses a substantially larger ring, thicker sweep, and readable unscaled text data', () => {
    expect(PARRY_READABILITY.countdownTicks).toBe(6);
    expect(PARRY_READABILITY.ringStartRadius).toBe(70);
    expect(PARRY_READABILITY.ringEndRadius).toBe(24);
    expect(PARRY_READABILITY.ringWidth).toBe(6);
    expect(PARRY_READABILITY.sweepWidth).toBe(5);
    expect(PARRY_READABILITY.countdownFontSize).toBe(26);
  });

  it('keeps the visible six-to-one countdown synchronized with the same real contact tick', () => {
    const sim = incomingLight();
    const initial = predictAttackTelegraph(sim.ai, sim.player, sim.frame);
    const countdowns: number[] = [];
    for (let guard = 0; guard < ATTACKS.light.startup + ATTACKS.light.active + 4; guard += 1) {
      const cue = predictAttackTelegraph(sim.ai, sim.player, sim.frame);
      if (cue.ringActive) countdowns.push(cue.countdownTicks!);
      sim.step(idle, aiIdle);
      if (sim.events.some((event) => event.type === 'hit' && event.actor === 'ai')) break;
    }
    const hit = sim.events.find((event) => event.type === 'hit' && event.actor === 'ai');
    expect(countdowns).toEqual([6, 5, 4, 3, 2, 1]);
    expect(hit?.frame).toBe(initial.predictedContactTick);
  });

  it('does not widen the three-tick intercept and clears red authority on the fourth tick', () => {
    const sim = new CombatSimulation();
    sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
    sim.ai.position = { x: 750, y: 300 };
    sim.step(input({ light: true }), aiIdle);
    const active = [combatPose(sim.player).parryActive];
    for (let tick = 0; tick < PARRY.active; tick += 1) {
      sim.step(input({ light: true }), aiIdle);
      active.push(combatPose(sim.player).parryActive);
    }
    expect(PARRY.active).toBe(3);
    expect(active).toEqual([true, true, true, false]);
  });
});