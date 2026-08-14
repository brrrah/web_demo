import { describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT, ITEMS, LOADOUT_STORAGE_KEY, TRAITS, loadLoadout, sanitizeLoadout, saveLoadout } from '../src/playerLoadout';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('personal loadout', () => {
  it('sanitizes character, trait, and item selections independently', () => {
    expect(sanitizeLoadout({ characterId: 'aria', traitId: TRAITS[2].id, itemId: ITEMS[1].id })).toEqual({
      characterId: 'aria', traitId: 'rush-tempo', itemId: 'guard-charm',
    });
    expect(sanitizeLoadout({ characterId: 'missing', traitId: 'missing', itemId: 'missing' })).toEqual(DEFAULT_LOADOUT);
  });

  it('persists a sanitized loadout and restores it', () => {
    const storage = new MemoryStorage();
    const saved = saveLoadout(storage, { characterId: 'aria', traitId: 'steady-breath', itemId: 'runner-boots' });
    expect(JSON.parse(storage.values.get(LOADOUT_STORAGE_KEY)!)).toEqual(saved);
    expect(loadLoadout(storage)).toEqual(saved);
  });

  it('falls back safely when persisted data is malformed or storage is unavailable', () => {
    const storage = new MemoryStorage();
    storage.values.set(LOADOUT_STORAGE_KEY, '{broken');
    expect(loadLoadout(storage)).toEqual(DEFAULT_LOADOUT);
    expect(loadLoadout()).toEqual(DEFAULT_LOADOUT);
  });
});
