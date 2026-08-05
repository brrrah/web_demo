import { ATTACKS, DODGE, FEINT, PARRY, type AttackKind } from './combatData';

export interface MotionVec2 { x: number; y: number }
export interface MotionFighter {
  position: MotionVec2;
  velocity: MotionVec2;
  facing: MotionVec2;
  state: string;
  stateFrame: number;
  attack: AttackKind | null;
  attackDelay: number;
  parrySuccessFrames: number;
  spawnFrames: number;
  lastFeintKind: AttackKind | null;
  bladeInterceptFrames: number;
  attackForwardMomentum: number;
}

export type MotionState =
  | 'idle' | 'move' | 'respawn'
  | 'bladeIntercept' | 'lightWindup' | 'lightActive' | 'lightRecovery'
  | 'heavyWindup' | 'heavyHold' | 'heavyActive' | 'heavyRecovery'
  | 'parryStartup' | 'parryActive' | 'parryRecovery' | 'parrySuccess' | 'feintRecovery'
  | 'dash' | 'dodge' | 'hitstun' | 'parried' | 'dead';

export interface AttackTimeline {
  kind: AttackKind;
  phase: 'startup' | 'active' | 'recovery';
  phaseFrame: number;
  phaseLength: number;
  phaseProgress: number;
  activeTick: number | null;
  expectedContactFrame: number;
}

export interface WeaponSweep {
  kind: AttackKind;
  activeTick: number;
  previousAngle: number;
  currentAngle: number;
  startAngle: number;
  endAngle: number;
  innerReach: number;
  reach: number;
  bladeLength: number;
}

export interface CombatPose {
  animation: MotionState;
  phase: AttackTimeline['phase'] | 'none';
  phaseProgress: number;
  bodyTwist: number;
  lean: number;
  weaponAngle: number;
  previousWeaponAngle: number;
  weaponLength: number;
  handDistance: number;
  hand: MotionVec2;
  tip: MotionVec2;
  previousTip: MotionVec2;
  expectedContactFrame: number | null;
  parryActive: boolean;
  parryTicksRemaining: number;
  rollPhase: 'none' | 'rollStartup' | 'rollInvulnerable' | 'rollLanding';
  rollProgress: number;
  rollRotation: number;
  rollTuck: number;
  rollInvulnerable: boolean;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
export const facingAngle = (facing: MotionVec2): number => Math.atan2(facing.y, facing.x);

export function attackTimeline(fighter: MotionFighter): AttackTimeline | null {
  if (fighter.state !== 'attack' || !fighter.attack) return null;
  const data = ATTACKS[fighter.attack];
  const startup = data.startup + fighter.attackDelay;
  if (fighter.stateFrame < startup) {
    return { kind: fighter.attack, phase: 'startup', phaseFrame: fighter.stateFrame, phaseLength: startup, phaseProgress: startup > 0 ? fighter.stateFrame / startup : 1, activeTick: null, expectedContactFrame: startup };
  }
  if (fighter.stateFrame < startup + data.active) {
    const phaseFrame = fighter.stateFrame - startup;
    return { kind: fighter.attack, phase: 'active', phaseFrame, phaseLength: data.active, phaseProgress: (phaseFrame + 1) / data.active, activeTick: phaseFrame, expectedContactFrame: startup };
  }
  const phaseFrame = fighter.stateFrame - startup - data.active;
  return { kind: fighter.attack, phase: 'recovery', phaseFrame, phaseLength: data.recovery, phaseProgress: data.recovery > 0 ? phaseFrame / data.recovery : 1, activeTick: null, expectedContactFrame: startup };
}

export function activeWeaponSweep(fighter: MotionFighter): WeaponSweep | null {
  const timeline = attackTimeline(fighter);
  if (!timeline || timeline.phase !== 'active' || timeline.activeTick === null) return null;
  const data = ATTACKS[timeline.kind];
  const previousProgress = timeline.activeTick / data.active;
  const currentProgress = (timeline.activeTick + 1) / data.active;
  return {
    kind: timeline.kind, activeTick: timeline.activeTick,
    previousAngle: lerp(data.sweepStartAngle, data.sweepEndAngle, previousProgress),
    currentAngle: lerp(data.sweepStartAngle, data.sweepEndAngle, currentProgress),
    startAngle: data.sweepStartAngle, endAngle: data.sweepEndAngle,
    innerReach: data.innerReach, reach: data.reach, bladeLength: data.bladeLength,
  };
}

export function angleInSweep(angle: number, start: number, end: number, tolerance = 0): boolean {
  return angle >= Math.min(start, end) - tolerance && angle <= Math.max(start, end) + tolerance;
}

export function targetIntersectsSweep(fighter: MotionFighter, target: MotionVec2, targetRadius = 16): boolean {
  const sweep = activeWeaponSweep(fighter);
  if (!sweep) return false;
  const dx = target.x - fighter.position.x;
  const dy = target.y - fighter.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance < sweep.innerReach - targetRadius || distance > sweep.reach + targetRadius) return false;
  const relativeAngle = normalizeAngle(Math.atan2(dy, dx) - facingAngle(fighter.facing));
  const angularTolerance = Math.asin(Math.min(1, targetRadius / Math.max(targetRadius, distance)));
  return angleInSweep(relativeAngle, sweep.previousAngle, sweep.currentAngle, angularTolerance);
}

export function expectedContactActiveTick(kind: AttackKind, relativeAngle: number, distance: number, targetRadius = 16): number | null {
  const data = ATTACKS[kind];
  if (distance < data.innerReach - targetRadius || distance > data.reach + targetRadius) return null;
  const tolerance = Math.asin(Math.min(1, targetRadius / Math.max(targetRadius, distance)));
  for (let tick = 0; tick < data.active; tick += 1) {
    const start = lerp(data.sweepStartAngle, data.sweepEndAngle, tick / data.active);
    const end = lerp(data.sweepStartAngle, data.sweepEndAngle, (tick + 1) / data.active);
    if (angleInSweep(normalizeAngle(relativeAngle), start, end, tolerance)) return tick;
  }
  return null;
}

export function incomingContactTick(attacker: MotionFighter, target: MotionFighter, currentTick: number): number | null {
  const timeline = attackTimeline(attacker);
  if (!timeline) return null;
  const dx = target.position.x - attacker.position.x;
  const dy = target.position.y - attacker.position.y;
  const relativeAngle = normalizeAngle(Math.atan2(dy, dx) - facingAngle(attacker.facing));
  const activeTick = expectedContactActiveTick(timeline.kind, relativeAngle, Math.hypot(dx, dy));
  if (activeTick === null) return null;
  return currentTick + Math.max(0, timeline.expectedContactFrame - attacker.stateFrame) + activeTick;
}

export function combatPose(fighter: MotionFighter): CombatPose {
  let poseBaseAngle = facingAngle(fighter.facing);
  const timeline = attackTimeline(fighter);
  let animation: MotionState = 'idle';
  let bodyTwist = 0;
  let lean = 0;
  let relativeWeaponAngle = 0.4;
  let previousRelativeAngle = relativeWeaponAngle;
  let weaponLength = 56;
  let handDistance = 13;
  let rollPhase: CombatPose['rollPhase'] = 'none';
  let rollProgress = 0;
  let rollRotation = 0;
  let rollTuck = 0;
  let rollInvulnerable = false;

  if (fighter.spawnFrames > 0 && fighter.state === 'idle') {
    animation = 'respawn'; lean = 0.15 * fighter.spawnFrames / 12;
  } else if (timeline) {
    const data = ATTACKS[timeline.kind];
    weaponLength = data.bladeLength;
    if (timeline.phase === 'startup') {
      const baseProgress = Math.min(1, fighter.stateFrame / data.startup);
      const heldProgress = fighter.attackDelay > 0 ? clamp01((fighter.stateFrame - data.startup) / fighter.attackDelay) : 0;
      relativeWeaponAngle = lerp(0.4, data.windupAngle, baseProgress) - heldProgress * (timeline.kind === 'heavy' ? 0.18 : 0.06);
      previousRelativeAngle = relativeWeaponAngle;
      bodyTwist = lerp(0, timeline.kind === 'heavy' ? -0.6 : -0.34, baseProgress);
      animation = fighter.bladeInterceptFrames > 0 ? 'bladeIntercept' : timeline.kind === 'heavy' && fighter.stateFrame >= data.startup ? 'heavyHold' : timeline.kind === 'heavy' ? 'heavyWindup' : 'lightWindup';
    } else if (timeline.phase === 'active') {
      const sweep = activeWeaponSweep(fighter)!;
      relativeWeaponAngle = sweep.currentAngle; previousRelativeAngle = sweep.previousAngle;
      bodyTwist = lerp(timeline.kind === 'heavy' ? -0.55 : -0.32, timeline.kind === 'heavy' ? 0.72 : 0.48, timeline.phaseProgress);
      animation = timeline.kind === 'heavy' ? 'heavyActive' : 'lightActive';
    } else {
      relativeWeaponAngle = lerp(data.sweepEndAngle, 0.4, timeline.phaseProgress);
      previousRelativeAngle = relativeWeaponAngle;
      bodyTwist = lerp(timeline.kind === 'heavy' ? 0.72 : 0.48, 0, timeline.phaseProgress);
      animation = timeline.kind === 'heavy' ? 'heavyRecovery' : 'lightRecovery';
    }
  } else if (fighter.state === 'feintRecovery') {
    animation = 'feintRecovery';
    const data = ATTACKS[fighter.lastFeintKind ?? 'light'];
    const progress = clamp01((FEINT.recovery - fighter.stateFrame) / FEINT.recovery);
    relativeWeaponAngle = lerp(data.windupAngle, 0.4, progress);
    previousRelativeAngle = relativeWeaponAngle;
    bodyTwist = lerp(fighter.lastFeintKind === 'heavy' ? -0.6 : -0.34, 0, progress);
    weaponLength = data.bladeLength;
  } else if (fighter.parrySuccessFrames > 0) {
    animation = 'parrySuccess'; relativeWeaponAngle = -0.15; previousRelativeAngle = relativeWeaponAngle; bodyTwist = -0.12;
  } else if (fighter.state === 'parry') {
    if (fighter.stateFrame < PARRY.startup) animation = 'parryStartup';
    else if (fighter.stateFrame < PARRY.startup + PARRY.active) animation = 'parryActive';
    else animation = 'parryRecovery';
    const raised = clamp01(fighter.stateFrame / PARRY.startup);
    relativeWeaponAngle = lerp(0.4, -0.85, raised); previousRelativeAngle = relativeWeaponAngle; handDistance = 10;
  } else if (fighter.state === 'dash') {
    animation = 'dash'; lean = 0.58 * (1 - fighter.stateFrame / 6); bodyTwist = -0.24; relativeWeaponAngle = 0.58;
  } else if (fighter.state === 'dodge') {
    animation = 'dodge';
    if (Math.hypot(fighter.velocity.x, fighter.velocity.y) > 0.01) poseBaseAngle = Math.atan2(fighter.velocity.y, fighter.velocity.x);
    if (fighter.stateFrame < DODGE.startup) {
      rollPhase = 'rollStartup';
      rollProgress = clamp01(fighter.stateFrame / DODGE.startup);
      rollTuck = rollProgress;
      lean = lerp(0.18, 0.82, rollProgress);
    } else if (fighter.stateFrame < DODGE.startup + DODGE.invulnerable) {
      rollPhase = 'rollInvulnerable';
      rollProgress = clamp01((fighter.stateFrame - DODGE.startup) / DODGE.invulnerable);
      rollRotation = rollProgress * Math.PI * 2;
      rollTuck = 1;
      rollInvulnerable = true;
      lean = 0.82;
    } else {
      rollPhase = 'rollLanding';
      rollProgress = clamp01((fighter.stateFrame - DODGE.startup - DODGE.invulnerable + 1) / DODGE.landing);
      rollRotation = Math.PI * 2;
      rollTuck = 1 - rollProgress;
      lean = lerp(0.72, 0.08, rollProgress);
    }
    bodyTwist = Math.sin(rollRotation) * 0.65;
    relativeWeaponAngle = 0.78 + Math.sin(rollRotation + 0.7) * 0.5;
    previousRelativeAngle = relativeWeaponAngle;
    handDistance = lerp(13, 7, rollTuck);
  } else if (fighter.state === 'hitstun') {
    animation = 'hitstun'; lean = -0.45; relativeWeaponAngle = 1.4;
  } else if (fighter.state === 'parried') {
    animation = 'parried'; lean = -0.5; relativeWeaponAngle = -2.15; bodyTwist = -0.5;
  } else if (fighter.state === 'dead') {
    animation = 'dead'; lean = 1.35; relativeWeaponAngle = 1.8;
  } else if (Math.hypot(fighter.velocity.x, fighter.velocity.y) > 0.1) {
    animation = 'move'; lean = 0.12;
  }

  if (timeline && fighter.attackForwardMomentum > 0) lean += Math.min(0.24, fighter.attackForwardMomentum * 0.1);
  const angle = poseBaseAngle + relativeWeaponAngle;
  const previousAngle = poseBaseAngle + previousRelativeAngle;
  const hand = { x: fighter.position.x + Math.cos(poseBaseAngle + bodyTwist) * handDistance, y: fighter.position.y + Math.sin(poseBaseAngle + bodyTwist) * handDistance };
  const activeReach = timeline?.phase === 'active' && timeline ? ATTACKS[timeline.kind].reach : null;
  const tip = activeReach === null
    ? { x: hand.x + Math.cos(angle) * weaponLength, y: hand.y + Math.sin(angle) * weaponLength }
    : { x: fighter.position.x + Math.cos(angle) * activeReach, y: fighter.position.y + Math.sin(angle) * activeReach };
  const previousTip = activeReach === null
    ? { x: hand.x + Math.cos(previousAngle) * weaponLength, y: hand.y + Math.sin(previousAngle) * weaponLength }
    : { x: fighter.position.x + Math.cos(previousAngle) * activeReach, y: fighter.position.y + Math.sin(previousAngle) * activeReach };
  weaponLength = Math.hypot(tip.x - hand.x, tip.y - hand.y);
  const legacyParryFrame = fighter.state === 'parry' ? fighter.stateFrame : -1;
  const legacyParryActive = legacyParryFrame >= PARRY.startup && legacyParryFrame < PARRY.startup + PARRY.active;
  const bladeParryActive = fighter.state === 'attack' && fighter.attack === 'light' && fighter.bladeInterceptFrames > 0;
  const parryActive = legacyParryActive || bladeParryActive;
  const parryTicksRemaining = bladeParryActive ? fighter.bladeInterceptFrames : legacyParryActive ? PARRY.startup + PARRY.active - legacyParryFrame : 0;
  return {
    animation, phase: timeline?.phase ?? 'none', phaseProgress: timeline?.phaseProgress ?? 0,
    bodyTwist, lean, weaponAngle: angle, previousWeaponAngle: previousAngle, weaponLength, handDistance, hand,
    tip, previousTip, expectedContactFrame: timeline?.expectedContactFrame ?? null,
    parryActive, parryTicksRemaining,
    rollPhase, rollProgress, rollRotation, rollTuck, rollInvulnerable,
  };
}

export function normalizeAngle(angle: number): number {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}