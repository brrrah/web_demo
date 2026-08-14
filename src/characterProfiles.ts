export type CharacterId = 'vanguard' | 'aria';

export interface FighterPalette {
  body: number;
  bodyDark: number;
  skin: number;
  arm: number;
  blade: number;
  glow: number;
  hair: number;
  hairDark: number;
  accent: number;
}

export interface CharacterProfile {
  id: CharacterId;
  name: string;
  subtitle: string;
  description: string;
  silhouette: 'vanguard' | 'heroine';
  palette: FighterPalette;
}

export const DEFAULT_CHARACTER_ID: CharacterId = 'vanguard';

export const CHARACTER_PROFILES: readonly CharacterProfile[] = [
  {
    id: 'vanguard',
    name: 'VANGUARD',
    subtitle: '기본 전사',
    description: '굵고 단단한 실루엣의 표준 검사',
    silhouette: 'vanguard',
    palette: {
      body: 0x157f86,
      bodyDark: 0x0a4850,
      skin: 0xd7faff,
      arm: 0x3fcad1,
      blade: 0xcaffff,
      glow: 0x63ffff,
      hair: 0x15343e,
      hairDark: 0x071c22,
      accent: 0x8fffff,
    },
  },
  {
    id: 'aria',
    name: 'ARIA',
    subtitle: '미소녀 네온 검사',
    description: '긴 자홍 머리와 시안 블레이드를 지닌 쾌속 검사',
    silhouette: 'heroine',
    palette: {
      body: 0x6754d9,
      bodyDark: 0x27205f,
      skin: 0xffdfd2,
      arm: 0x8c7bff,
      blade: 0xd9ffff,
      glow: 0x66ffff,
      hair: 0xff6fcf,
      hairDark: 0x8e296f,
      accent: 0xffd454,
    },
  },
] as const;

export const AI_PROFILE: CharacterProfile = {
  id: 'vanguard',
  name: 'RIVAL',
  subtitle: '전투 AI',
  description: '자홍색 라이벌 검사',
  silhouette: 'vanguard',
  palette: {
    body: 0x9a246f,
    bodyDark: 0x58113e,
    skin: 0xffd9ef,
    arm: 0xe85aaa,
    blade: 0xffd1f0,
    glow: 0xff69c8,
    hair: 0x4b1539,
    hairDark: 0x26091c,
    accent: 0xff9bd7,
  },
};

export function resolveCharacterProfile(id: unknown): CharacterProfile {
  return CHARACTER_PROFILES.find((profile) => profile.id === id) ?? CHARACTER_PROFILES[0];
}
