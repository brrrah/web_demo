import { ATTACKS, DODGE, FEINT, FIXED_HZ, GROUND_DASH, HEAVY_DELAY_FRAMES, HIT_FEEDBACK, MOVEMENT, PARRY, ROUND_FRAMES, attackForwardStep, type AttackKind } from './combatData';
import { activeWeaponSweep, attackTimeline, targetIntersectsSweep } from './combatMotion';
import { resolveAttackAim } from './aimAssist';

export type FighterState = 'idle' | 'attack' | 'feintRecovery' | 'parry' | 'dash' | 'dodge' | 'hitstun' | 'parried' | 'dead';
export type AttackPhase = 'none' | 'startup' | 'active' | 'recovery';
export type ParryPhase = 'none' | 'startup' | 'active' | 'recovery';
export type RollPhase = 'none' | 'rollStartup' | 'rollInvulnerable' | 'rollLanding';
export type BladeActionResult = 'NONE' | 'ATTACK' | 'PARRY' | 'WHIFF' | 'BLOCKED';
export type AIState = 'spacing' | 'approach' | 'lightAttack' | 'heavyAttack' | 'dodge' | 'parry' | 'recovery';

export interface Vec2 { x: number; y: number }
export interface FighterInput {
  move: Vec2;
  aim: Vec2;
  light: boolean;
  heavy: boolean;
  dodge: boolean;
  parry: boolean;
  feint: boolean;
  dash: Vec2 | null;
  delayHeavy?: boolean;
}

export const NO_INPUT: FighterInput = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, light: false, heavy: false, dodge: false, parry: false, feint: false, dash: null };

export interface Fighter {
  id: 'player' | 'ai';
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  hp: number;
  state: FighterState;
  stateFrame: number;
  attack: AttackKind | null;
  attackDelay: number;
  attackInstanceId: number;
  hitTargets: Fighter['id'][];
  parrySuccessFrames: number;
  spawnFrames: number;
  feintCooldown: number;
  lastFeintKind: AttackKind | null;
  parryCooldown: number;
  dodgeCooldown: number;
  dodgeCharges: number;
  dodgeRecharge: number;
  dashCooldown: number;
  lastMoveDirection: Vec2 | null;
  bladeInterceptFrames: number;
  lastBladeActionResult: BladeActionResult;
  lastBladeInputFrame: number | null;
  lastParrySuccessFrame: number | null;
  lastParryFailFrame: number | null;
  attackForwardMomentum: number;
  flashFrames: number;
  trailFrames: number;
}

export interface CombatEvent {
  frame: number;
  type: 'hit' | 'parry' | 'earlyParry' | 'feint' | 'dash' | 'dodge' | 'death' | 'restart';
  actor: string;
  target?: string;
  attackInstanceId?: number;
  contactActiveTick?: number;
  weaponAngle?: number;
  contactX?: number;
  contactY?: number;
}

export const ARENA_BOUNDS = { minX: 95, maxX: 865, minY: 105, maxY: 485 } as const;

function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  return length > 0.0001 ? { x: v.x / length, y: v.y / length } : { x: 0, y: 0 };
}

function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(target, current + maximumDelta);
  if (current > target) return Math.max(target, current - maximumDelta);
  return target;
}

function createFighter(id: Fighter['id'], position: Vec2, facing: Vec2): Fighter {
  return {
    id, position: { ...position }, velocity: { x: 0, y: 0 }, facing, hp: 100, state: 'idle', stateFrame: 0,
    attack: null, attackDelay: 0, attackInstanceId: 0, hitTargets: [], parrySuccessFrames: 0, spawnFrames: 12,
    feintCooldown: 0, lastFeintKind: null, parryCooldown: 0, dodgeCooldown: 0, dodgeCharges: DODGE.charges,
    dodgeRecharge: 0, dashCooldown: 0, lastMoveDirection: null, bladeInterceptFrames: 0, lastBladeActionResult: 'NONE', lastBladeInputFrame: null,
    lastParrySuccessFrame: null, lastParryFailFrame: null, attackForwardMomentum: 0, flashFrames: 0, trailFrames: 0,
  };
}

export class CombatSimulation {
  readonly fixedHz = FIXED_HZ;
  frame = 0;
  roundFrames = ROUND_FRAMES;
  hitstopFrames = 0;
  winner: Fighter['id'] | 'draw' | null = null;
  player = createFighter('player', { x: 300, y: 300 }, { x: 1, y: 0 });
  ai = createFighter('ai', { x: 660, y: 300 }, { x: -1, y: 0 });
  events: CombatEvent[] = [];
  restartCount = 0;

  restart(): void {
    this.player = createFighter('player', { x: 300, y: 300 }, { x: 1, y: 0 });
    this.ai = createFighter('ai', { x: 660, y: 300 }, { x: -1, y: 0 });
    this.frame = 0; this.roundFrames = ROUND_FRAMES; this.hitstopFrames = 0; this.winner = null;
    this.events = [{ frame: 0, type: 'restart', actor: 'system' }]; this.restartCount += 1;
  }

  clearTransientControl(): void {
    for (const fighter of [this.player, this.ai]) {
      fighter.velocity = { x: 0, y: 0 };
      fighter.attackForwardMomentum = 0;
      if (fighter.state === 'dash' || fighter.state === 'dodge') this.toIdle(fighter);
    }
  }

  step(playerInput: FighterInput, aiInput: FighterInput): void {
    if (this.winner) return;
    this.frame += 1;
    if (this.hitstopFrames > 0) { this.hitstopFrames -= 1; return; }
    this.roundFrames -= 1;
    this.tickFighter(this.player, playerInput, this.ai);
    this.tickFighter(this.ai, aiInput, this.player);
    this.resolveAttack(this.player, this.ai);
    this.resolveAttack(this.ai, this.player);
    this.separateFighters();
    this.clampFighter(this.player); this.clampFighter(this.ai);
    if (this.player.hp <= 0 || this.ai.hp <= 0) this.winner = this.player.hp <= 0 ? (this.ai.hp <= 0 ? 'draw' : 'ai') : 'player';
    if (this.roundFrames <= 0) this.winner = this.player.hp === this.ai.hp ? 'draw' : this.player.hp > this.ai.hp ? 'player' : 'ai';
  }

  attackPhase(fighter: Fighter): AttackPhase { return attackTimeline(fighter)?.phase ?? 'none'; }

  parryPhase(fighter: Fighter): ParryPhase {
    if (fighter.state === 'attack' && fighter.attack === 'light' && fighter.bladeInterceptFrames > 0) return 'active';
    if (fighter.state !== 'parry') return 'none';
    if (fighter.stateFrame < PARRY.startup) return 'startup';
    if (fighter.stateFrame < PARRY.startup + PARRY.active) return 'active';
    return 'recovery';
  }

  bladeActionState(fighter: Fighter): string {
    if (fighter.state === 'attack' && fighter.attack === 'light' && fighter.bladeInterceptFrames > 0) return 'INTERCEPT';
    if (fighter.state === 'attack' && fighter.attack === 'light') return this.attackPhase(fighter).toUpperCase();
    if (fighter.parrySuccessFrames > 0 && fighter.lastBladeActionResult === 'PARRY') return 'PARRY_SUCCESS';
    return 'IDLE';
  }

  rollPhase(fighter: Fighter): RollPhase {
    if (fighter.state !== 'dodge') return 'none';
    if (fighter.stateFrame < DODGE.startup) return 'rollStartup';
    if (fighter.stateFrame < DODGE.startup + DODGE.invulnerable) return 'rollInvulnerable';
    return 'rollLanding';
  }

  isRollInvulnerable(fighter: Fighter): boolean { return this.rollPhase(fighter) === 'rollInvulnerable'; }

  rollInvulnerableFramesRemaining(fighter: Fighter): number {
    return this.isRollInvulnerable(fighter) ? DODGE.startup + DODGE.invulnerable - fighter.stateFrame : 0;
  }

  private tickFighter(fighter: Fighter, input: FighterInput, opponent: Fighter): void {
    fighter.parryCooldown = Math.max(0, fighter.parryCooldown - 1);
    fighter.feintCooldown = Math.max(0, fighter.feintCooldown - 1);
    fighter.dodgeCooldown = Math.max(0, fighter.dodgeCooldown - 1);
    fighter.dashCooldown = Math.max(0, fighter.dashCooldown - 1);
    fighter.flashFrames = Math.max(0, fighter.flashFrames - 1);
    fighter.trailFrames = Math.max(0, fighter.trailFrames - 1);
    fighter.parrySuccessFrames = Math.max(0, fighter.parrySuccessFrames - 1);
    fighter.spawnFrames = Math.max(0, fighter.spawnFrames - 1);
    fighter.attackForwardMomentum = 0;
    if (fighter.dodgeCharges < DODGE.charges) {
      fighter.dodgeRecharge += 1;
      if (fighter.dodgeRecharge >= DODGE.recharge) { fighter.dodgeCharges += 1; fighter.dodgeRecharge = 0; }
    }
    const aim = normalize(input.aim);
    if (Math.hypot(aim.x, aim.y) > 0 && fighter.state !== 'attack') fighter.facing = aim;
    if (fighter.state === 'dead') { if (input.light) this.blockBladeAction(fighter); return; }

    if (fighter.state === 'idle') {
      if (input.dodge && fighter.dodgeCooldown === 0 && fighter.dodgeCharges > 0) this.startDodge(fighter, input.move);
      else if (input.light) this.startBladeAction(fighter, opponent);
      else if (input.parry && fighter.parryCooldown === 0) {
        fighter.state = 'parry'; fighter.stateFrame = 0; fighter.parryCooldown = PARRY.cooldown;
      } else if (input.heavy) this.startAttack(fighter, opponent, 'heavy', Boolean(input.delayHeavy));
      else if (input.dash && fighter.dashCooldown === 0) this.startDash(fighter, input.dash);
      else this.moveFighter(fighter, input.move);
    } else if (fighter.state === 'dash') {
      if (input.light) this.startBladeAction(fighter, opponent);
      else {
        fighter.position.x += fighter.velocity.x; fighter.position.y += fighter.velocity.y;
        fighter.stateFrame += 1;
        if (fighter.stateFrame >= GROUND_DASH.duration) this.toIdle(fighter);
      }
    } else if (fighter.state === 'dodge') {
      if (input.light) this.blockBladeAction(fighter);
      const phase = this.rollPhase(fighter);
      const speedScale = phase === 'rollStartup' ? 0.55 : phase === 'rollInvulnerable' ? 1 : 0.35;
      fighter.position.x += fighter.velocity.x * speedScale; fighter.position.y += fighter.velocity.y * speedScale;
      fighter.stateFrame += 1;
      if (fighter.stateFrame >= DODGE.duration) this.toIdle(fighter);
    } else if (fighter.state === 'attack') {
      if (input.light) this.blockBladeAction(fighter);
      if (fighter.bladeInterceptFrames > 0) {
        fighter.bladeInterceptFrames -= 1;
        if (fighter.bladeInterceptFrames === 0) { fighter.lastParryFailFrame = this.frame; fighter.lastBladeActionResult = 'ATTACK'; }
      }
      const attack = fighter.attack!; const data = ATTACKS[attack];
      const commitmentFrame = data.startup + fighter.attackDelay - FEINT.commitmentBuffer;
      const canFeint = input.feint && fighter.feintCooldown === 0 && fighter.stateFrame >= FEINT.earliestFrame && fighter.stateFrame < commitmentFrame;
      const timeline = attackTimeline(fighter);
      const canDash = input.dash && fighter.dashCooldown === 0 && attack === 'light' && fighter.hitTargets.length > 0 && timeline?.phase === 'recovery' && timeline.phaseProgress >= 0.5;
      if (canFeint) {
        fighter.state = 'feintRecovery'; fighter.stateFrame = FEINT.recovery; fighter.feintCooldown = FEINT.cooldown;
        fighter.lastFeintKind = attack; fighter.attack = null; fighter.hitTargets = []; fighter.velocity = { x: 0, y: 0 };
        fighter.lastBladeActionResult = attack === 'light' ? 'WHIFF' : fighter.lastBladeActionResult;
        this.events.push({ frame: this.frame, type: 'feint', actor: fighter.id, attackInstanceId: fighter.attackInstanceId });
      } else if (canDash) this.startDash(fighter, input.dash!);
      else {
        const nextStateFrame = fighter.stateFrame + 1;
        const momentum = attackForwardStep(attack, nextStateFrame, fighter.attackDelay);
        fighter.attackForwardMomentum = momentum;
        fighter.position.x += fighter.facing.x * momentum; fighter.position.y += fighter.facing.y * momentum;
        fighter.stateFrame = nextStateFrame;
        if (this.attackPhase(fighter) === 'active') fighter.trailFrames = 3;
        if (fighter.stateFrame >= data.startup + fighter.attackDelay + data.active + data.recovery) {
          if (attack === 'light' && fighter.lastBladeActionResult === 'ATTACK' && fighter.hitTargets.length === 0) fighter.lastBladeActionResult = 'WHIFF';
          this.toIdle(fighter);
        }
      }
    } else if (fighter.state === 'parry') {
      if (input.light) this.blockBladeAction(fighter);
      if (input.dash && fighter.parrySuccessFrames > 0 && fighter.dashCooldown === 0) this.startDash(fighter, input.dash);
      else {
        fighter.stateFrame += 1;
        if (fighter.stateFrame >= PARRY.startup + PARRY.active + PARRY.recovery) {
          fighter.lastParryFailFrame = this.frame;
          this.events.push({ frame: this.frame, type: 'earlyParry', actor: fighter.id }); this.toIdle(fighter);
        }
      }
    } else if (fighter.state === 'parried') {
      if (input.light) this.blockBladeAction(fighter);
      const elapsed = PARRY.attackerStun - fighter.stateFrame;
      if (elapsed < PARRY.recoilTicks) {
        fighter.position.x += fighter.velocity.x; fighter.position.y += fighter.velocity.y;
        fighter.velocity.x *= 0.55; fighter.velocity.y *= 0.55;
      } else fighter.velocity = { x: 0, y: 0 };
      fighter.stateFrame -= 1;
      if (fighter.stateFrame <= 0) this.toIdle(fighter);
    } else {
      if (input.light) this.blockBladeAction(fighter);
      fighter.position.x += fighter.velocity.x; fighter.position.y += fighter.velocity.y;
      fighter.velocity.x *= 0.78; fighter.velocity.y *= 0.78; fighter.stateFrame -= 1;
      if (fighter.stateFrame <= 0) this.toIdle(fighter);
    }
    this.clampFighter(fighter);
  }

  private moveFighter(fighter: Fighter, moveInput: Vec2): void {
    const move = normalize(moveInput);
    const hasMove = Math.hypot(move.x, move.y) > 0;
    if (hasMove) fighter.lastMoveDirection = { ...move };
    const target = { x: move.x * MOVEMENT.speedX, y: move.y * MOVEMENT.speedY };
    const delta = hasMove ? MOVEMENT.acceleration : MOVEMENT.deceleration;
    fighter.velocity.x = approach(fighter.velocity.x, target.x, delta);
    fighter.velocity.y = approach(fighter.velocity.y, target.y, delta);
    if (Math.abs(fighter.velocity.x) < 0.001) fighter.velocity.x = 0;
    if (Math.abs(fighter.velocity.y) < 0.001) fighter.velocity.y = 0;
    fighter.position.x += fighter.velocity.x; fighter.position.y += fighter.velocity.y;
  }

  private startBladeAction(fighter: Fighter, opponent: Fighter): void {
    fighter.facing = resolveAttackAim(fighter.position, fighter.facing, opponent.position).facing;
    fighter.state = 'attack'; fighter.stateFrame = 0; fighter.attack = 'light'; fighter.attackDelay = 0;
    fighter.attackInstanceId += 1; fighter.hitTargets = []; fighter.velocity = { x: 0, y: 0 }; fighter.attackForwardMomentum = 0;
    fighter.parryCooldown = PARRY.cooldown; fighter.bladeInterceptFrames = PARRY.active; fighter.lastBladeInputFrame = this.frame; fighter.lastBladeActionResult = 'NONE';
  }

  private startAttack(fighter: Fighter, opponent: Fighter, kind: AttackKind, delayHeavy: boolean): void {
    fighter.facing = resolveAttackAim(fighter.position, fighter.facing, opponent.position).facing;
    fighter.state = 'attack'; fighter.stateFrame = 0; fighter.attack = kind; fighter.attackDelay = kind === 'heavy' && delayHeavy ? HEAVY_DELAY_FRAMES : 0;
    fighter.attackInstanceId += 1; fighter.hitTargets = []; fighter.velocity = { x: 0, y: 0 }; fighter.bladeInterceptFrames = 0; fighter.attackForwardMomentum = 0;
  }

  private startDodge(fighter: Fighter, moveInput: Vec2): void {
    const move = normalize(moveInput);
    const direction = Math.hypot(move.x, move.y) > 0 ? move : fighter.lastMoveDirection ?? fighter.facing;
    if (Math.hypot(move.x, move.y) > 0) fighter.lastMoveDirection = { ...move };
    fighter.state = 'dodge'; fighter.stateFrame = 0; fighter.velocity = { x: direction.x * DODGE.speed, y: direction.y * DODGE.speed };
    fighter.dodgeCharges -= 1; fighter.dodgeCooldown = DODGE.cooldown;
    this.events.push({ frame: this.frame, type: 'dodge', actor: fighter.id });
  }

  private startDash(fighter: Fighter, directionInput: Vec2): void {
    const direction = normalize(directionInput);
    if (Math.hypot(direction.x, direction.y) === 0) return;
    fighter.state = 'dash'; fighter.stateFrame = 0; fighter.velocity = { x: direction.x * GROUND_DASH.speed, y: direction.y * GROUND_DASH.speed };
    fighter.lastMoveDirection = { ...direction }; fighter.dashCooldown = GROUND_DASH.cooldown;
    this.events.push({ frame: this.frame, type: 'dash', actor: fighter.id });
  }

  private blockBladeAction(fighter: Fighter): void {
    fighter.lastBladeInputFrame = this.frame; fighter.lastBladeActionResult = 'BLOCKED';
  }

  private resolveAttack(attacker: Fighter, defender: Fighter): void {
    if (this.attackPhase(attacker) !== 'active' || attacker.hitTargets.includes(defender.id) || defender.state === 'dead') return;
    if (!targetIntersectsSweep(attacker, defender.position)) return;
    const attackKind = attacker.attack!; const attack = ATTACKS[attackKind]; const sweep = activeWeaponSweep(attacker)!;
    const delta = { x: defender.position.x - attacker.position.x, y: defender.position.y - attacker.position.y }; const toward = normalize(delta);
    const weaponTip = { x: attacker.position.x + Math.cos(Math.atan2(attacker.facing.y, attacker.facing.x) + sweep.currentAngle) * sweep.reach, y: attacker.position.y + Math.sin(Math.atan2(attacker.facing.y, attacker.facing.x) + sweep.currentAngle) * sweep.reach };
    const contact = { x: (weaponTip.x + defender.position.x) / 2, y: (weaponTip.y + defender.position.y) / 2 };
    attacker.hitTargets.push(defender.id);
    if (this.isRollInvulnerable(defender)) return;
    const eventDetails = { attackInstanceId: attacker.attackInstanceId, contactActiveTick: sweep.activeTick, weaponAngle: sweep.currentAngle, contactX: contact.x, contactY: contact.y };
    if (this.parryPhase(defender) === 'active') {
      attacker.state = 'parried'; attacker.stateFrame = PARRY.attackerStun; attacker.attack = null; attacker.attackForwardMomentum = 0; attacker.velocity = { x: -toward.x * 2.4, y: -toward.y * 2.4 };
      defender.state = 'parry'; defender.stateFrame = PARRY.startup + PARRY.active + PARRY.recovery - PARRY.counterRecovery;
      defender.attack = null; defender.attackDelay = 0; defender.bladeInterceptFrames = 0; defender.hitTargets = []; defender.velocity = { x: 0, y: 0 }; defender.attackForwardMomentum = 0;
      defender.parrySuccessFrames = 6; defender.flashFrames = HIT_FEEDBACK.flashTicks; defender.lastBladeActionResult = 'PARRY'; defender.lastParrySuccessFrame = this.frame;
      this.hitstopFrames = HIT_FEEDBACK.parryHitstop;
      this.events.push({ frame: this.frame, type: 'parry', actor: defender.id, target: attacker.id, ...eventDetails }); return;
    }
    if (attacker.attack === 'light') attacker.lastBladeActionResult = 'ATTACK';
    if (defender.bladeInterceptFrames > 0) defender.lastBladeActionResult = 'BLOCKED';
    defender.hp = Math.max(0, defender.hp - attack.damage);
    defender.state = defender.hp === 0 ? 'dead' : 'hitstun'; defender.stateFrame = defender.hp === 0 ? 0 : attack.hitstun;
    defender.attack = null; defender.attackDelay = 0; defender.bladeInterceptFrames = 0; defender.hitTargets = []; defender.attackForwardMomentum = 0;
    defender.velocity = { x: toward.x * attack.knockback / 5, y: toward.y * attack.knockback / 5 };
    defender.flashFrames = HIT_FEEDBACK.flashTicks; this.hitstopFrames = attackKind === 'heavy' ? HIT_FEEDBACK.heavyHitstop : HIT_FEEDBACK.lightHitstop;
    this.events.push({ frame: this.frame, type: defender.hp === 0 ? 'death' : 'hit', actor: attacker.id, target: defender.id, ...eventDetails });
  }

  private separateFighters(): void {
    const dx = this.ai.position.x - this.player.position.x; const dy = this.ai.position.y - this.player.position.y; const distance = Math.hypot(dx, dy);
    if (distance >= 42 || distance === 0) return;
    const overlap = (42 - distance) / 2; const n = { x: dx / distance, y: dy / distance };
    this.player.position.x -= n.x * overlap; this.player.position.y -= n.y * overlap;
    this.ai.position.x += n.x * overlap; this.ai.position.y += n.y * overlap;
  }

  private clampFighter(fighter: Fighter): void {
    fighter.position.x = Math.max(ARENA_BOUNDS.minX, Math.min(ARENA_BOUNDS.maxX, fighter.position.x));
    fighter.position.y = Math.max(ARENA_BOUNDS.minY, Math.min(ARENA_BOUNDS.maxY, fighter.position.y));
  }

  private toIdle(fighter: Fighter): void {
    fighter.state = 'idle'; fighter.stateFrame = 0; fighter.attack = null; fighter.attackDelay = 0; fighter.bladeInterceptFrames = 0; fighter.hitTargets = []; fighter.velocity = { x: 0, y: 0 }; fighter.attackForwardMomentum = 0;
  }
}

export class SimpleCombatAI {
  state: AIState = 'spacing'; private decisionFrames = 0; private seed = 0x12345678;
  reset(): void { this.state = 'spacing'; this.decisionFrames = 0; this.seed = 0x12345678; }

  decide(sim: CombatSimulation): FighterInput {
    const self = sim.ai; const target = sim.player;
    const delta = { x: target.position.x - self.position.x, y: target.position.y - self.position.y };
    const distance = Math.hypot(delta.x, delta.y); const toward = normalize(delta);
    if (self.state !== 'idle') {
      this.state = self.state === 'attack' ? (self.attack === 'heavy' ? 'heavyAttack' : 'lightAttack') : self.state === 'dodge' ? 'dodge' : self.state === 'parry' ? 'parry' : 'recovery';
      return { ...NO_INPUT, aim: toward };
    }
    this.decisionFrames -= 1;
    if (this.decisionFrames <= 0) {
      this.decisionFrames = 14 + Math.floor(this.random() * 18);
      if ((target.state === 'attack') && distance < 110 && this.random() < 0.18 && self.parryCooldown === 0) this.state = 'parry';
      else if (distance > 150) this.state = 'approach';
      else if (distance < 62 && this.random() < 0.34 && self.dodgeCharges > 0) this.state = 'dodge';
      else if (distance < 105) this.state = this.random() < 0.65 ? 'lightAttack' : 'heavyAttack';
      else this.state = 'spacing';
    }
    const side = { x: -toward.y, y: toward.x };
    if (this.state === 'approach') return { ...NO_INPUT, aim: toward, move: toward };
    if (this.state === 'spacing') return { ...NO_INPUT, aim: toward, move: this.random() < 0.5 ? side : { x: -side.x, y: -side.y } };
    if (this.state === 'lightAttack') return { ...NO_INPUT, aim: toward, light: true };
    if (this.state === 'heavyAttack') return { ...NO_INPUT, aim: toward, heavy: true, delayHeavy: this.random() < 0.55 };
    if (this.state === 'dodge') return { ...NO_INPUT, aim: toward, move: { x: -toward.x, y: -toward.y }, dodge: true };
    if (this.state === 'parry') return { ...NO_INPUT, aim: toward, parry: true };
    return { ...NO_INPUT, aim: toward };
  }

  private random(): number { this.seed = (1664525 * this.seed + 1013904223) >>> 0; return this.seed / 0x100000000; }
}