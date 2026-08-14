import { DEFAULT_CHARACTER_ID, resolveCharacterProfile, type CharacterId } from './characterProfiles';

export type TraitId = 'counter-instinct' | 'steady-breath' | 'rush-tempo';
export type ItemId = 'training-blade' | 'guard-charm' | 'runner-boots';

export interface LoadoutOption<T extends string> {
  id: T;
  name: string;
  description: string;
}

export interface PlayerLoadout {
  characterId: CharacterId;
  traitId: TraitId;
  itemId: ItemId;
}

export interface LoadoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LOADOUT_STORAGE_KEY = 'neon-blade.loadout.v1';

export const TRAITS: readonly LoadoutOption<TraitId>[] = [
  { id: 'counter-instinct', name: 'COUNTER INSTINCT', description: '패링 중심 프리셋 · 효과는 후속 단계에서 활성화' },
  { id: 'steady-breath', name: 'STEADY BREATH', description: '안정적인 공방 프리셋 · 효과는 후속 단계에서 활성화' },
  { id: 'rush-tempo', name: 'RUSH TEMPO', description: '대시 압박 프리셋 · 효과는 후속 단계에서 활성화' },
] as const;

export const ITEMS: readonly LoadoutOption<ItemId>[] = [
  { id: 'training-blade', name: 'TRAINING BLADE', description: '기본 훈련검 · 현재 전투 수치 변경 없음' },
  { id: 'guard-charm', name: 'GUARD CHARM', description: '방어 부적 · 현재 전투 수치 변경 없음' },
  { id: 'runner-boots', name: 'RUNNER BOOTS', description: '기동 장화 · 현재 전투 수치 변경 없음' },
] as const;

export const DEFAULT_LOADOUT: PlayerLoadout = {
  characterId: DEFAULT_CHARACTER_ID,
  traitId: TRAITS[0].id,
  itemId: ITEMS[0].id,
};

function isTraitId(value: unknown): value is TraitId {
  return TRAITS.some((option) => option.id === value);
}

function isItemId(value: unknown): value is ItemId {
  return ITEMS.some((option) => option.id === value);
}

export function sanitizeLoadout(value: unknown): PlayerLoadout {
  if (!value || typeof value !== 'object') return { ...DEFAULT_LOADOUT };
  const candidate = value as Partial<PlayerLoadout>;
  return {
    characterId: resolveCharacterProfile(candidate.characterId).id,
    traitId: isTraitId(candidate.traitId) ? candidate.traitId : DEFAULT_LOADOUT.traitId,
    itemId: isItemId(candidate.itemId) ? candidate.itemId : DEFAULT_LOADOUT.itemId,
  };
}

export function loadLoadout(storage?: LoadoutStorage): PlayerLoadout {
  if (!storage) return { ...DEFAULT_LOADOUT };
  try {
    const raw = storage.getItem(LOADOUT_STORAGE_KEY);
    return raw ? sanitizeLoadout(JSON.parse(raw)) : { ...DEFAULT_LOADOUT };
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}

export function saveLoadout(storage: LoadoutStorage | undefined, loadout: PlayerLoadout): PlayerLoadout {
  const sanitized = sanitizeLoadout(loadout);
  try {
    storage?.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // The in-memory selection remains usable when browser storage is unavailable.
  }
  return sanitized;
}

export function traitById(id: TraitId): LoadoutOption<TraitId> {
  return TRAITS.find((option) => option.id === id) ?? TRAITS[0];
}

export function itemById(id: ItemId): LoadoutOption<ItemId> {
  return ITEMS.find((option) => option.id === id) ?? ITEMS[0];
}
