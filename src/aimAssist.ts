import { AIM_ASSIST } from './combatData';

export interface AimVector { x: number; y: number }

export interface AttackAimResult {
  facing: AimVector;
  applied: boolean;
  distance: number;
  targetAngle: number;
  correction: number;
}

const EPSILON = 0.0001;

function normalize(vector: AimVector): AimVector | null {
  const length = Math.hypot(vector.x, vector.y);
  return length > EPSILON ? { x: vector.x / length, y: vector.y / length } : null;
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

export function resolveAttackAim(origin: AimVector, intendedAim: AimVector, target: AimVector): AttackAimResult {
  const intended = normalize(intendedAim) ?? { x: 1, y: 0 };
  const delta = { x: target.x - origin.x, y: target.y - origin.y };
  const distance = Math.hypot(delta.x, delta.y);
  const targetDirection = normalize(delta);
  if (!targetDirection) return { facing: intended, applied: false, distance, targetAngle: 0, correction: 0 };

  const intendedAngle = Math.atan2(intended.y, intended.x);
  const targetAngle = normalizeAngle(Math.atan2(targetDirection.y, targetDirection.x) - intendedAngle);
  if (distance > AIM_ASSIST.maxRange || Math.abs(targetAngle) > AIM_ASSIST.maxTargetAngle) {
    return { facing: intended, applied: false, distance, targetAngle, correction: 0 };
  }

  const correction = Math.max(-AIM_ASSIST.maxCorrection, Math.min(AIM_ASSIST.maxCorrection, targetAngle));
  const correctedAngle = intendedAngle + correction;
  return {
    facing: { x: Math.cos(correctedAngle), y: Math.sin(correctedAngle) },
    applied: Math.abs(correction) > EPSILON,
    distance,
    targetAngle,
    correction,
  };
}
