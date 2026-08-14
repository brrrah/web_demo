export type AttackKind = 'light' | 'heavy';

export interface AttackFrames {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  reach: number;
  innerReach: number;
  knockback: number;
  hitstun: number;
  windupAngle: number;
  sweepStartAngle: number;
  sweepEndAngle: number;
  bladeLength: number;
  forwardDistance: number;
  momentumLeadTicks: number;
}

const degrees = (value: number): number => value * Math.PI / 180;

export const ATTACKS: Record<AttackKind, AttackFrames> = {
  light: {
    startup: 12, active: 4, recovery: 16, damage: 12,
    reach: 88, innerReach: 28, knockback: 18, hitstun: 12,
    windupAngle: degrees(-112), sweepStartAngle: degrees(-72), sweepEndAngle: degrees(66), bladeLength: 68,
    forwardDistance: 10, momentumLeadTicks: 4,
  },
  heavy: {
    startup: 24, active: 6, recovery: 24, damage: 24,
    reach: 102, innerReach: 30, knockback: 34, hitstun: 20,
    windupAngle: degrees(-148), sweepStartAngle: degrees(-98), sweepEndAngle: degrees(96), bladeLength: 82,
    forwardDistance: 13, momentumLeadTicks: 6,
  },
};

export const HEAVY_DELAY_FRAMES = 8;
export const AIM_ASSIST = { maxRange: 128, maxTargetAngle: degrees(18), maxCorrection: degrees(6) } as const;
export const MOVEMENT = { speedX: 5.2, speedY: 4.4, acceleration: 5.8, deceleration: 3.4 } as const;
export const GROUND_DASH = { doubleTapWindow: 10, duration: 6, cooldown: 18, speed: 13.2 } as const;
export const FEINT = { earliestFrame: 4, commitmentBuffer: 2, recovery: 16, cooldown: 30 } as const;
export const PARRY = { startup: 4, active: 3, recovery: 20, cooldown: 28, counterRecovery: 6, attackerStun: 60, recoilTicks: 6 } as const;
export const DODGE = { startup: 2, invulnerable: 8, landing: 6, duration: 16, cooldown: 12, speed: 9, charges: 2, recharge: 108 } as const;
export const HIT_FEEDBACK = { lightHitstop: 2, heavyHitstop: 4, parryHitstop: 4, flashTicks: 5 } as const;
export const FIXED_HZ = 60;
export const ROUND_FRAMES = FIXED_HZ * 60;

export function attackForwardStep(kind: AttackKind, stateFrame: number, attackDelay: number): number {
  const data = ATTACKS[kind];
  const activeStart = data.startup + attackDelay;
  const momentumStart = activeStart - data.momentumLeadTicks;
  const momentumEnd = activeStart + data.active;
  if (stateFrame < momentumStart || stateFrame >= momentumEnd) return 0;
  return data.forwardDistance / (data.momentumLeadTicks + data.active);
}