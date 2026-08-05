import { ATTACKS, attackForwardStep, type AttackKind } from './combatData';
import { activeWeaponSweep, attackTimeline, targetIntersectsSweep, type MotionFighter, type MotionVec2 } from './combatMotion';

export const TELEGRAPH_COUNTDOWN_TICKS = 6;

export interface AttackTelegraph {
  active: boolean;
  kind: AttackKind | null;
  yellowArcActive: boolean;
  ringActive: boolean;
  promptActive: boolean;
  contactFlashActive: boolean;
  predictedContactTick: number | null;
  countdownTicks: number | null;
  ringProgress: number;
  arcStartAngle: number | null;
  arcEndAngle: number | null;
  reach: number;
  predictedOrigin: MotionVec2 | null;
  predictedTip: MotionVec2 | null;
  predictedContactPoint: MotionVec2 | null;
  predictedActiveTick: number | null;
}

const emptyTelegraph = (): AttackTelegraph => ({
  active: false,
  kind: null,
  yellowArcActive: false,
  ringActive: false,
  promptActive: false,
  contactFlashActive: false,
  predictedContactTick: null,
  countdownTicks: null,
  ringProgress: 0,
  arcStartAngle: null,
  arcEndAngle: null,
  reach: 0,
  predictedOrigin: null,
  predictedTip: null,
  predictedContactPoint: null,
  predictedActiveTick: null,
});

const blocksTelegraph = (target: MotionFighter): boolean => (
  target.state === 'dodge' || target.state === 'hitstun' || target.state === 'parried' || target.state === 'dead'
);

export function predictAttackTelegraph(attacker: MotionFighter, target: MotionFighter, currentTick: number): AttackTelegraph {
  const initialTimeline = attackTimeline(attacker);
  if (!initialTimeline || !attacker.attack || blocksTelegraph(target)) return emptyTelegraph();

  const data = ATTACKS[attacker.attack];
  const finalActiveFrame = data.startup + attacker.attackDelay + data.active - 1;
  const predictedPosition = { ...attacker.position };

  for (let futureFrame = attacker.stateFrame + 1; futureFrame <= finalActiveFrame; futureFrame += 1) {
    const momentum = attackForwardStep(attacker.attack, futureFrame, attacker.attackDelay);
    predictedPosition.x += attacker.facing.x * momentum;
    predictedPosition.y += attacker.facing.y * momentum;
    const predicted: MotionFighter = {
      ...attacker,
      position: { ...predictedPosition },
      stateFrame: futureFrame,
    };
    const sweep = activeWeaponSweep(predicted);
    if (!sweep || !targetIntersectsSweep(predicted, target.position)) continue;

    const countdownTicks = futureFrame - attacker.stateFrame;
    const ringActive = countdownTicks >= 1 && countdownTicks <= TELEGRAPH_COUNTDOWN_TICKS;
    const promptActive = countdownTicks === 1;
    const baseAngle = Math.atan2(attacker.facing.y, attacker.facing.x);
    const tip = {
      x: predictedPosition.x + Math.cos(baseAngle + sweep.currentAngle) * sweep.reach,
      y: predictedPosition.y + Math.sin(baseAngle + sweep.currentAngle) * sweep.reach,
    };
    return {
      active: true,
      kind: attacker.attack,
      yellowArcActive: initialTimeline.phase === 'startup',
      ringActive,
      promptActive,
      contactFlashActive: promptActive,
      predictedContactTick: currentTick + countdownTicks,
      countdownTicks,
      ringProgress: ringActive ? (TELEGRAPH_COUNTDOWN_TICKS - countdownTicks) / TELEGRAPH_COUNTDOWN_TICKS : 0,
      arcStartAngle: data.sweepStartAngle,
      arcEndAngle: data.sweepEndAngle,
      reach: data.reach,
      predictedOrigin: { ...predictedPosition },
      predictedTip: tip,
      predictedContactPoint: { x: (tip.x + target.position.x) / 2, y: (tip.y + target.position.y) / 2 },
      predictedActiveTick: sweep.activeTick,
    };
  }

  return emptyTelegraph();
}