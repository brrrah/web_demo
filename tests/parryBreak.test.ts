import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, type FighterInput } from '../src/combat';
import { ATTACKS, FIXED_HZ, HIT_FEEDBACK, PARRY } from '../src/combatData';

const input = (value: Partial<FighterInput> = {}): FighterInput => ({
  ...NO_INPUT,
  ...value,
  move: value.move ?? NO_INPUT.move,
  aim: value.aim ?? { x: 1, y: 0 },
  dash: value.dash ?? null,
});
const idle = input();
const aiIdle = input({ aim: { x: -1, y: 0 } });
const aggressive = input({ move: { x: -1, y: 0 }, light: true, heavy: true, dodge: true, feint: true, dash: { x: -1, y: 0 }, aim: { x: -1, y: 0 } });

function place(sim: CombatSimulation): void {
  sim.player.spawnFrames = 0; sim.ai.spawnFrames = 0;
  sim.player.position = { x: 400, y: 300 }; sim.player.facing = { x: 1, y: 0 };
  sim.ai.position = { x: 470, y: 300 }; sim.ai.facing = { x: -1, y: 0 };
}

function stepMany(sim: CombatSimulation, ticks: number, player = idle, ai = aiIdle): void {
  for (let tick = 0; tick < ticks; tick += 1) sim.step(player, ai);
}

function successfulPlayerParry(): CombatSimulation {
  const sim = new CombatSimulation(); place(sim);
  sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
  stepMany(sim, 10);
  sim.step(input({ light: true }), aiIdle);
  stepMany(sim, 2);
  expect(sim.events.some((event) => event.type === 'parry' && event.actor === 'player')).toBe(true);
  return sim;
}

describe('user-authorized one-second parry break advantage', () => {
  it('defines one full second of attacker action lock without widening the parry window', () => {
    expect(PARRY.active).toBe(3);
    expect(PARRY.attackerStun).toBe(FIXED_HZ);
    expect(PARRY.recoilTicks).toBe(6);
  });

  it('blocks movement, attack, dodge, dash, and feint for all sixty combat ticks after a short recoil', () => {
    const sim = successfulPlayerParry();
    expect(sim.ai.state).toBe('parried');
    expect(sim.ai.stateFrame).toBe(60);
    stepMany(sim, HIT_FEEDBACK.parryHitstop, idle, aggressive);

    stepMany(sim, PARRY.recoilTicks, idle, aggressive);
    const lockedPosition = { ...sim.ai.position };
    expect(sim.ai.velocity).not.toEqual(aggressive.move);
    stepMany(sim, PARRY.attackerStun - PARRY.recoilTicks - 1, idle, aggressive);
    expect(sim.ai.state).toBe('parried');
    expect(sim.ai.stateFrame).toBe(1);
    expect(sim.ai.position).toEqual(lockedPosition);
    expect(sim.events.some((event) => event.actor === 'ai' && (event.type === 'dash' || event.type === 'dodge' || event.type === 'feint'))).toBe(false);

    sim.step(idle, aggressive);
    expect(sim.ai.state).toBe('idle');
    sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } }));
    expect(sim.ai.state).toBe('attack');
  });

  it('leaves enough real advantage for the defender to recover and land a heavy counter', () => {
    const sim = successfulPlayerParry();
    stepMany(sim, HIT_FEEDBACK.parryHitstop + PARRY.counterRecovery);
    expect(sim.player.state).toBe('idle');
    expect(sim.ai.state).toBe('parried');
    expect(sim.ai.stateFrame).toBe(PARRY.attackerStun - PARRY.counterRecovery);

    sim.step(input({ heavy: true }), aggressive);
    for (let guard = 0; guard < ATTACKS.heavy.startup + ATTACKS.heavy.active + 4 && sim.ai.hp === 100; guard += 1) sim.step(idle, aggressive);
    expect(sim.ai.hp).toBe(100 - ATTACKS.heavy.damage);
    expect(sim.events.some((event) => event.type === 'hit' && event.actor === 'player')).toBe(true);
  });

  it('is deterministic across batching and clears the break completely on restart', () => {
    const replay = (batches: number[]) => {
      const sim = successfulPlayerParry();
      let cursor = 0;
      for (const batch of batches) for (let count = 0; count < batch && cursor < 40; count += 1) {
        sim.step(idle, aggressive); cursor += 1;
      }
      return { frame: sim.frame, state: sim.ai.state, stateFrame: sim.ai.stateFrame, position: sim.ai.position, events: sim.events };
    };
    expect(replay([40])).toEqual(replay([1, 2, 7, 5, 25]));

    const reset = successfulPlayerParry();
    reset.restart();
    expect(reset.ai.state).toBe('idle');
    expect(reset.ai.stateFrame).toBe(0);
    expect(reset.ai.velocity).toEqual({ x: 0, y: 0 });
  });
});