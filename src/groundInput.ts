import { GROUND_DASH } from './combatData';

export type MoveKey = 'W' | 'A' | 'S' | 'D';
export interface GroundDirection { x: number; y: number }
export interface TapDebugState { firstDownTick: number | null; released: boolean; remainingTicks: number }

export const DASH_DIRECTIONS: Record<MoveKey, GroundDirection> = {
  W: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  A: { x: -1, y: 0 },
  D: { x: 1, y: 0 },
};

export const PLAYER_GROUND_BINDINGS = {
  roll: 'SPACE',
  feint: 'Q',
  legacyParry: null,
  jump: null,
} as const;

interface TapState { firstDownTick: number | null; released: boolean }

const createTapState = (): Record<MoveKey, TapState> => ({
  W: { firstDownTick: null, released: false },
  A: { firstDownTick: null, released: false },
  S: { firstDownTick: null, released: false },
  D: { firstDownTick: null, released: false },
});

export function composeDashDirection(base: GroundDirection, heldMove: GroundDirection): GroundDirection {
  const perpendicular = Math.abs(base.x) > 0 ? Math.sign(heldMove.y) : Math.sign(heldMove.x);
  if (perpendicular === 0) return { ...base };
  const x = base.x === 0 ? perpendicular : base.x;
  const y = base.y === 0 ? perpendicular : base.y;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}
export class DoubleTapDashDetector {
  private taps = createTapState();

  keyDown(key: MoveKey, fixedTick: number, repeat = false): GroundDirection | null {
    if (repeat) return null;
    for (const other of Object.keys(this.taps) as MoveKey[]) {
      if (other !== key) this.taps[other] = { firstDownTick: null, released: false };
    }
    const tap = this.taps[key];
    if (tap.firstDownTick !== null && !tap.released) return null;
    if (tap.firstDownTick !== null && tap.released && fixedTick - tap.firstDownTick <= GROUND_DASH.doubleTapWindow) {
      this.taps[key] = { firstDownTick: null, released: false };
      return { ...DASH_DIRECTIONS[key] };
    }
    this.taps[key] = { firstDownTick: fixedTick, released: false };
    return null;
  }

  keyUp(key: MoveKey): void {
    if (this.taps[key].firstDownTick !== null) this.taps[key].released = true;
  }

  debugState(fixedTick: number): Record<MoveKey, TapDebugState> {
    return Object.fromEntries((Object.keys(this.taps) as MoveKey[]).map((key) => {
      const tap = this.taps[key];
      const remainingTicks = tap.firstDownTick === null ? 0 : Math.max(0, GROUND_DASH.doubleTapWindow - (fixedTick - tap.firstDownTick));
      return [key, { firstDownTick: tap.firstDownTick, released: tap.released, remainingTicks }];
    })) as Record<MoveKey, TapDebugState>;
  }

  reset(): void { this.taps = createTapState(); }
}
