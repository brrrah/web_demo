import { describe, expect, it } from 'vitest';
import { CombatSimulation, NO_INPUT, SimpleCombatAI, type FighterInput } from '../src/combat';
import { ATTACKS, DODGE, PARRY } from '../src/combatData';

const input = (value: Partial<FighterInput>): FighterInput => ({ ...NO_INPUT, ...value, move: value.move ?? NO_INPUT.move, aim: value.aim ?? { x: 1, y: 0 } });
const idle = input({});
const aiIdle = input({ aim: { x: -1, y: 0 } });

function placeInRange(sim: CombatSimulation): void { sim.player.position = { x: 400, y: 300 }; sim.ai.position = { x: 470, y: 300 }; sim.player.facing = { x: 1, y: 0 }; sim.ai.facing = { x: -1, y: 0 }; }
function advance(sim: CombatSimulation, frames: number, p = idle, a = idle): void { for (let i = 0; i < frames; i += 1) sim.step(p, a); }

describe('GAME-P0A deterministic combat', () => {
  it('moves both fighters freely in eight directions', () => {
    const sim = new CombatSimulation(); const aiStart = { ...sim.ai.position };
    sim.step(input({ move: { x: 1, y: -1 } }), input({ move: { x: -1, y: 1 }, aim: { x: -1, y: 0 } }));
    expect(sim.player.position.x).toBeGreaterThan(300); expect(sim.player.position.y).toBeLessThan(300);
    expect(sim.ai.position.x).toBeLessThan(aiStart.x); expect(sim.ai.position.y).toBeGreaterThan(aiStart.y);
  });

  it('keeps light and heavy frame data clearly distinct', () => {
    expect(ATTACKS.heavy.startup).toBeGreaterThan(ATTACKS.light.startup);
    expect(ATTACKS.heavy.recovery).toBeGreaterThan(ATTACKS.light.recovery);
    expect(ATTACKS.heavy.damage).toBeGreaterThan(ATTACKS.light.damage);
  });

  it('distinguishes early, successful, and late parry timing', () => {
    const early = new CombatSimulation(); placeInRange(early); early.step(input({ parry: true }), aiIdle); advance(early, PARRY.startup + PARRY.active + 1, idle, aiIdle); early.step(idle, input({ light: true, aim: { x: -1, y: 0 } })); advance(early, ATTACKS.light.startup + 5, idle, aiIdle); expect(early.player.hp).toBeLessThan(100);
    const success = new CombatSimulation(); placeInRange(success); success.step(idle, input({ light: true, aim: { x: -1, y: 0 } })); advance(success, ATTACKS.light.startup - PARRY.startup - 1, idle, aiIdle); success.step(input({ parry: true }), aiIdle); advance(success, PARRY.startup + 2, idle, aiIdle); expect(success.events.some((event) => event.type === 'parry')).toBe(true); expect(success.ai.state).toBe('parried');
    const late = new CombatSimulation(); placeInRange(late); late.step(idle, input({ light: true, aim: { x: -1, y: 0 } })); advance(late, ATTACKS.light.startup + 2, idle, aiIdle); late.step(input({ parry: true }), aiIdle); expect(late.player.hp).toBeLessThan(100);
  });

  it('grants counter advantage after a successful parry', () => {
    const sim = new CombatSimulation(); placeInRange(sim); sim.step(idle, input({ light: true, aim: { x: -1, y: 0 } })); advance(sim, ATTACKS.light.startup - PARRY.startup - 1, idle, aiIdle); sim.step(input({ parry: true }), aiIdle); advance(sim, PARRY.startup + 2, idle, aiIdle);
    advance(sim, PARRY.counterRecovery + 8, idle, aiIdle); expect(sim.player.state).toBe('idle'); expect(sim.ai.state).toBe('parried');
  });

  it('limits parry spam and dodge spam', () => {
    const sim = new CombatSimulation(); sim.step(input({ parry: true }), idle); advance(sim, 1); expect(sim.parryPhase(sim.player)).not.toBe('none'); expect(sim.player.parryCooldown).toBeGreaterThan(0);
    const dodge = new CombatSimulation(); dodge.step(input({ dodge: true, move: { x: 1, y: 0 } }), idle); advance(dodge, DODGE.duration + 1); dodge.step(input({ dodge: true, move: { x: 1, y: 0 } }), idle); advance(dodge, DODGE.duration + 1); expect(dodge.player.dodgeCharges).toBe(0); dodge.step(input({ dodge: true }), idle); expect(dodge.player.state).toBe('idle');
  });

  it('restarts ten rounds without leaked state', () => {
    const sim = new CombatSimulation(); for (let i = 0; i < 10; i += 1) { sim.player.hp = 1; sim.hitstopFrames = 5; sim.events.push({ frame: 1, type: 'hit', actor: 'ai' }); sim.restart(); expect(sim.player.hp).toBe(100); expect(sim.ai.hp).toBe(100); expect(sim.hitstopFrames).toBe(0); expect(sim.events).toHaveLength(1); expect(sim.frame).toBe(0); }
    expect(sim.restartCount).toBe(10);
  });

  it('produces identical adjudication for the same fixed-tick inputs regardless of render batching', () => {
    const run = (batches: number[]) => { const sim = new CombatSimulation(); placeInRange(sim); const inputs = Array.from({ length: 80 }, (_, frame) => input({ light: frame === 2, move: frame < 2 ? { x: 1, y: 0 } : { x: 0, y: 0 } })); let cursor = 0; for (const batch of batches) for (let count = 0; count < batch && cursor < inputs.length; count += 1) sim.step(inputs[cursor++], idle); return { hp: sim.ai.hp, state: sim.ai.state, events: sim.events.map((event) => event.type), frame: sim.frame }; };
    expect(run([80])).toEqual(run([1, 7, 2, 19, 3, 48]));
  });

  it('keeps AI inside the allowed state vocabulary', () => {
    const sim = new CombatSimulation(); const ai = new SimpleCombatAI(); const allowed = new Set(['spacing', 'approach', 'lightAttack', 'heavyAttack', 'dodge', 'parry', 'recovery']);
    for (let frame = 0; frame < 600; frame += 1) { sim.step(idle, ai.decide(sim)); expect(allowed.has(ai.state)).toBe(true); if (sim.winner) sim.restart(); }
  });

  it('replays twenty seconds of combat ticks and measures fixed-step throughput', () => {
    const sim = new CombatSimulation(); const ai = new SimpleCombatAI(); const started = performance.now();
    const phases: string[] = [];
    for (let frame = 0; frame < 1200; frame += 1) {
      let player = idle;
      if (frame < 70) player = input({ move: { x: 1, y: 0 } });
      else if (frame === 70) { player = input({ light: true }); phases.push('light poke'); }
      else if (frame === 105) { player = input({ dodge: true, move: { x: -1, y: 0 } }); phases.push('dodge'); }
      else if (frame === 145) { player = input({ heavy: true, delayHeavy: true }); phases.push('delayed heavy'); }
      else if (frame === 225) { player = input({ parry: true }); phases.push('early parry attempt'); }
      else if (frame > 280 && frame < 350) player = input({ move: { x: 1, y: 0 } });
      sim.step(player, ai.decide(sim));
      if (sim.winner) { sim.restart(); ai.reset(); }
    }
    const elapsedMs = performance.now() - started;
    expect(sim.frame).toBeGreaterThan(0);
    expect(phases).toEqual(['light poke', 'dodge', 'delayed heavy', 'early parry attempt']);
    expect(elapsedMs).toBeLessThan(1000);
    console.info(`20-second replay: ${elapsedMs.toFixed(2)}ms for 1200 scheduled ticks`);
  });});
