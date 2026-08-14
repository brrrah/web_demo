import { describe, expect, it } from 'vitest';
import { AI_PROFILE, CHARACTER_PROFILES, DEFAULT_CHARACTER_ID, resolveCharacterProfile } from '../src/characterProfiles';

describe('character selection profiles', () => {
  it('offers the default fighter and the heroine as distinct selectable silhouettes', () => {
    expect(CHARACTER_PROFILES.map((profile) => profile.id)).toEqual(['vanguard', 'aria']);
    expect(CHARACTER_PROFILES[0].silhouette).toBe('vanguard');
    expect(CHARACTER_PROFILES[1].silhouette).toBe('heroine');
    expect(CHARACTER_PROFILES[1].palette.hair).not.toBe(CHARACTER_PROFILES[0].palette.hair);
  });

  it('resolves known selections and safely falls back to the default profile', () => {
    expect(resolveCharacterProfile('aria').id).toBe('aria');
    expect(resolveCharacterProfile('vanguard').id).toBe(DEFAULT_CHARACTER_ID);
    expect(resolveCharacterProfile('unknown').id).toBe(DEFAULT_CHARACTER_ID);
    expect(resolveCharacterProfile(undefined).id).toBe(DEFAULT_CHARACTER_ID);
  });

  it('keeps the rival profile visually distinct from both player choices', () => {
    expect(AI_PROFILE.palette.body).not.toBe(CHARACTER_PROFILES[0].palette.body);
    expect(AI_PROFILE.palette.body).not.toBe(CHARACTER_PROFILES[1].palette.body);
    expect(AI_PROFILE.palette.glow).not.toBe(CHARACTER_PROFILES[1].palette.glow);
  });
});
