import type {
  AppearanceMode,
  CommandBarFontFamily,
  CommandBarSize,
  CommandBarWindowMode,
  ThemePreferences,
} from '@/types';

export const themeTokenNames = [
  '--cc-bg',
  '--cc-panel',
  '--cc-panel-raised',
  '--cc-input',
  '--cc-text',
  '--cc-muted',
  '--cc-subtle',
  '--cc-border',
  '--cc-border-strong',
  '--cc-control-border',
  '--cc-accent',
  '--cc-accent-contrast',
  '--cc-accent-soft',
  '--cc-focus',
  '--cc-danger',
  '--cc-success',
  '--cc-hover',
  '--cc-selection',
  '--cc-overlay-scrim',
  '--cc-shadow',
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];
export type ThemeTokens = Record<ThemeTokenName, string>;

export interface ThemePalettePreviewColors {
  background: string;
  accent: string;
}

export interface ThemePalettePreview {
  light: ThemePalettePreviewColors;
  dark: ThemePalettePreviewColors;
}

export interface ThemePalette {
  id: string;
  name: string;
  description: string;
  preview: ThemePalettePreview;
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

interface ThemeSurfaceColors {
  background: string;
  panel: string;
  raised: string;
  border: string;
}

interface ThemeTextColors {
  text: string;
  muted: string;
  subtle: string;
}

interface ThemeAccentColors {
  accent: string;
  hover: string;
  selection: string;
}

interface ThemeSourceColors extends ThemeSurfaceColors, ThemeTextColors, ThemeAccentColors {}

interface ThemeSource {
  id: string;
  name: string;
  description: string;
  appearance: 'light' | 'dark';
  colors: ThemeSourceColors;
}

interface PairedThemeSource {
  id: string;
  name: string;
  description: string;
  light: ThemeSourceColors;
  dark: ThemeSourceColors;
}

interface ContrastCandidate {
  color: string;
  distance: number;
}

const hexChannels = (color: string): [number, number, number] => {
  const value = color.replace('#', '');

  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
};

const hexColor = (channels: number[]): string => {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
};

const mixColors = (first: string, second: string, amount: number): string => {
  const a = hexChannels(first);
  const b = hexChannels(second);

  return hexColor(a.map((channel, index) => channel + (b[index] - channel) * amount));
};

const luminance = (color: string): number => {
  const [red, green, blue] = hexChannels(color)
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};

const contrast = (first: string, second: string): number => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (values[0] + 0.05) / (values[1] + 0.05);
};

const hasContrast = (foreground: string, surfaces: string[], minimum: number): boolean => {
  return surfaces.every((surface) => contrast(foreground, surface) >= minimum);
};

const ensureContrast = (foreground: string, surfaces: string[], minimum: number): string => {
  if (hasContrast(foreground, surfaces, minimum)) {
    return foreground;
  }

  const candidates: ContrastCandidate[] = [];

  for (const target of ['#000000', '#ffffff']) {
    for (let step = 1; step <= 100; step++) {
      const distance = step / 100;
      const color = mixColors(foreground, target, distance);

      if (hasContrast(color, surfaces, minimum)) {
        candidates.push({ color, distance });
        break;
      }
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance)[0]?.color ?? '#000000';
};

interface ResolvedAccent {
  accent: string;
  accentSoft: string;
}

const resolveAccent = (source: ThemeSourceColors, isDark: boolean): ResolvedAccent => {
  const input = source.panel;
  const accentBlend = isDark ? 0.15 : 0.09;
  let accent = source.accent;
  let accentSoft = mixColors(input, accent, accentBlend);

  for (let attempt = 0; attempt < 4; attempt++) {
    const nextAccent = ensureContrast(
      source.accent,
      [source.panel, source.raised, input, source.selection, accentSoft],
      4.5,
    );

    if (nextAccent === accent) {
      break;
    }

    accent = nextAccent;
    accentSoft = mixColors(input, accent, accentBlend);
  }

  accentSoft = mixColors(input, accent, accentBlend);

  if (contrast(accent, accentSoft) < 4.5) {
    accent = ensureContrast(accent, [accentSoft], 4.5);
    accentSoft = mixColors(input, accent, accentBlend);
  }

  return { accent, accentSoft };
};

const sourceTokens = (
  source: ThemeSourceColors,
  isDark: boolean,
  resolvedAccent = resolveAccent(source, isDark),
): ThemeTokens => {
  const { accent, accentSoft } = resolvedAccent;
  const input = source.panel;
  const textSurfaces = [source.background, source.panel, source.raised, input, source.selection, accentSoft];
  const accentText = contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111';
  const border = ensureContrast(source.border, [source.background, source.panel, source.raised, input], 3);

  return {
    '--cc-bg': source.background,
    '--cc-panel': source.panel,
    '--cc-panel-raised': source.raised,
    '--cc-input': input,
    '--cc-text': ensureContrast(source.text, textSurfaces, 4.5),
    '--cc-muted': ensureContrast(source.muted, textSurfaces, 4.5),
    '--cc-subtle': ensureContrast(source.subtle, textSurfaces, 4.5),
    '--cc-border': source.border,
    '--cc-border-strong': border,
    '--cc-control-border': border,
    '--cc-accent': accent,
    '--cc-accent-contrast': accentText,
    '--cc-accent-soft': accentSoft,
    '--cc-focus': ensureContrast(accent, [source.background, source.panel, source.selection, accentSoft], 3),
    '--cc-danger': isDark ? '#ff8b96' : '#b42336',
    '--cc-success': isDark ? '#78d49b' : '#207453',
    '--cc-hover': source.hover,
    '--cc-selection': source.selection,
    '--cc-overlay-scrim': isDark ? 'rgba(0, 0, 0, 0.48)' : 'rgba(18, 20, 22, 0.22)',
    '--cc-shadow': isDark ? '0 10px 28px rgba(0, 0, 0, 0.38)' : '0 10px 28px rgba(20, 24, 28, 0.15)',
  };
};

const alternateAppearance = (source: ThemeSourceColors, isDark: boolean): ThemeSourceColors => {
  if (isDark) {
    const background = mixColors('#15171a', source.accent, 0.035);
    const panel = mixColors('#1d2024', source.accent, 0.045);
    return {
      background,
      panel,
      raised: mixColors(panel, '#ffffff', 0.075),
      accent: source.accent,
      border: mixColors(panel, '#ffffff', 0.15),
      text: '#f3f4f2',
      muted: '#c1c4c9',
      subtle: '#b7bbc1',
      hover: mixColors(panel, source.accent, 0.095),
      selection: mixColors(panel, source.accent, 0.17),
    };
  }

  const background = mixColors('#f5f5f3', source.accent, 0.025);
  const panel = mixColors('#ffffff', source.accent, 0.015);
  return {
    background,
    panel,
    raised: mixColors('#f1f1ef', source.accent, 0.035),
    accent: source.accent,
    border: '#dededa',
    text: '#191a1c',
    muted: '#55585d',
    subtle: '#5c6066',
    hover: mixColors(panel, source.accent, 0.055),
    selection: mixColors(panel, source.accent, 0.105),
  };
};

const lazyPalette = (
  source: Pick<PairedThemeSource, 'id' | 'name' | 'description'>,
  lightSource: ThemeSourceColors,
  darkSource: ThemeSourceColors,
): ThemePalette => {
  let lightTokens: ThemeTokens | undefined;
  let darkTokens: ThemeTokens | undefined;
  let lightAccent: ResolvedAccent | undefined;
  let darkAccent: ResolvedAccent | undefined;
  const getLightAccent = () => (lightAccent ??= resolveAccent(lightSource, false));
  const getDarkAccent = () => (darkAccent ??= resolveAccent(darkSource, true));

  return {
    id: source.id,
    name: source.name,
    description: source.description,
    preview: {
      light: { background: lightSource.background, accent: getLightAccent().accent },
      dark: { background: darkSource.background, accent: getDarkAccent().accent },
    },
    get light() {
      return (lightTokens ??= sourceTokens(lightSource, false, getLightAccent()));
    },
    get dark() {
      return (darkTokens ??= sourceTokens(darkSource, true, getDarkAccent()));
    },
  };
};

const singleAppearancePalette = (source: ThemeSource): ThemePalette => {
  const alternate = alternateAppearance(source.colors, source.appearance === 'light');
  const lightSource = source.appearance === 'light' ? source.colors : alternate;
  const darkSource = source.appearance === 'dark' ? source.colors : alternate;

  return lazyPalette(source, lightSource, darkSource);
};

const pairedPalette = (source: PairedThemeSource): ThemePalette => {
  return lazyPalette(source, source.light, source.dark);
};

const plain = pairedPalette({
  id: 'plain',
  name: 'Plain',
  description: 'Black and white',
  light: {
    background: '#ffffff',
    panel: '#ffffff',
    raised: '#f4f4f4',
    accent: '#111111',
    border: '#e4e4e4',
    text: '#111111',
    muted: '#555555',
    subtle: '#5c5c5c',
    hover: '#f2f2f2',
    selection: '#e9e9e9',
  },
  dark: {
    background: '#050505',
    panel: '#111111',
    raised: '#1d1d1d',
    accent: '#ffffff',
    border: '#353535',
    text: '#fafafa',
    muted: '#c2c2c2',
    subtle: '#b4b4b4',
    hover: '#1d1d1d',
    selection: '#292929',
  },
});

// Native appearance colors are ported from the user's Termscape palette definitions.
const termscapePalettes: ThemeSource[] = [
  {
    id: 'cursor-dark',
    name: 'Cursor Dark',
    description: 'Graphite and pale cyan',
    appearance: 'dark',
    colors: {
      background: '#141414',
      panel: '#181818',
      raised: '#262626',
      accent: '#88c0d0',
      border: '#292929',
      text: '#e4e4e4',
      muted: '#888888',
      subtle: '#636363',
      hover: '#272727',
      selection: '#343434',
    },
  },
  {
    id: 'cursor-midnight',
    name: 'Cursor Midnight',
    description: 'Midnight slate and sea glass',
    appearance: 'dark',
    colors: {
      background: '#191c22',
      panel: '#1e2127',
      raised: '#434c5e',
      accent: '#8fbcbb',
      border: '#292c32',
      text: '#d8dee9',
      muted: '#7b88a1',
      subtle: '#4b5163',
      hover: '#2a2d33',
      selection: '#35373d',
    },
  },
  {
    id: 'vscode-dark-vs',
    name: 'VS Code Dark',
    description: 'Classic editor charcoal',
    appearance: 'dark',
    colors: {
      background: '#252526',
      panel: '#1e1e1e',
      raised: '#2d2d2e',
      accent: '#007acc',
      border: '#303030',
      text: '#d4d4d4',
      muted: '#8c8c8c',
      subtle: '#616161',
      hover: '#2a2a2a',
      selection: '#353535',
    },
  },
  {
    id: 'tobacco',
    name: 'Tobacco',
    description: 'Warm charcoal and amber',
    appearance: 'dark',
    colors: {
      background: '#242222',
      panel: '#201e1c',
      raised: '#2d2a2a',
      accent: '#eb9c3d',
      border: '#343230',
      text: '#ededed',
      muted: '#a1a0a0',
      subtle: '#706f6e',
      hover: '#302e2c',
      selection: '#3d3b3a',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Charcoal with violet',
    appearance: 'dark',
    colors: {
      background: '#21222c',
      panel: '#282a36',
      raised: '#44475a',
      accent: '#bd93f9',
      border: '#394057',
      text: '#e7e8e3',
      muted: '#9a9b9d',
      subtle: '#6b6c72',
      hover: '#343246',
      selection: '#403b55',
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    description: 'Mocha and lavender',
    appearance: 'dark',
    colors: {
      background: '#1e1e2e',
      panel: '#181825',
      raised: '#313244',
      accent: '#cba6f7',
      border: '#313242',
      text: '#bfc7e3',
      muted: '#767b91',
      subtle: '#4b4d5f',
      hover: '#252234',
      selection: '#332d45',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Deep space and cyan',
    appearance: 'dark',
    colors: {
      background: '#10151e',
      panel: '#0a0e16',
      raised: '#181f2d',
      accent: '#00d8ff',
      border: '#082e3b',
      text: '#b0d1ec',
      muted: '#6d8396',
      subtle: '#404e5c',
      hover: '#091c26',
      selection: '#092a37',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    description: 'Earthy retro warmth',
    appearance: 'dark',
    colors: {
      background: '#282828',
      panel: '#1d2021',
      raised: '#3c3836',
      accent: '#fe8019',
      border: '#35312d',
      text: '#dbcca6',
      muted: '#9a8d7a',
      subtle: '#5b584c',
      hover: '#2f2820',
      selection: '#3f2e20',
    },
  },
  {
    id: 'nordic',
    name: 'Nordic',
    description: 'Polar slate and frost',
    appearance: 'dark',
    colors: {
      background: '#2e3440',
      panel: '#242933',
      raised: '#3b4252',
      accent: '#88c0d0',
      border: '#3a3e47',
      text: '#d9dbe1',
      muted: '#92969d',
      subtle: '#646871',
      hover: '#333841',
      selection: '#3e434b',
    },
  },
];

const pairedPalettes: PairedThemeSource[] = [
  {
    id: 't3-code',
    name: 'T3 Code',
    description: 'Clean neutrals and blue',
    light: {
      background: '#fcfcfc',
      panel: '#ffffff',
      raised: '#f4f4f5',
      accent: '#1b4ed8',
      border: '#e4e4e7',
      text: '#27272a',
      muted: '#71717b',
      subtle: '#71717b',
      hover: '#f4f4f5',
      selection: '#e0e6f7',
    },
    dark: {
      background: '#0a0a0a',
      panel: '#111111',
      raised: '#141414',
      accent: '#346bf1',
      border: '#292929',
      text: '#f5f5f5',
      muted: '#a3a3a3',
      subtle: '#a3a3a3',
      hover: '#141414',
      selection: '#1a1b1b',
    },
  },
  {
    id: 't3-ocean',
    name: 'Ocean',
    description: 'Blue-gray with sea glass',
    light: {
      background: '#f5f7f8',
      panel: '#f5f7f8',
      raised: '#edeff1',
      accent: '#2672af',
      border: '#cdd4dc',
      text: '#241523',
      muted: '#746c75',
      subtle: '#746c75',
      hover: '#cdddea',
      selection: '#b7cfe2',
    },
    dark: {
      background: '#17212b',
      panel: '#17212b',
      raised: '#333b45',
      accent: '#70b9ee',
      border: '#405567',
      text: '#fffaff',
      muted: '#8d8f97',
      subtle: '#8d8f97',
      hover: '#283e50',
      selection: '#324f66',
    },
  },
];

// Settings discovers this registry. Add a palette definition; controls and persisted preferences share its stable ID.
export const themeRegistry: ThemePalette[] = [
  plain,
  ...termscapePalettes.map(singleAppearancePalette),
  ...pairedPalettes.map(pairedPalette),
];

export interface CommandBarSizeOption {
  id: CommandBarSize;
  label: string;
  description: string;
}

// Widths live in global.css as --cc-bar-width and --cc-popup-width, keyed by the root's data-size attribute.
export const commandBarSizes: CommandBarSizeOption[] = [
  { id: 'compact', label: 'Compact', description: 'Focused width' },
  { id: 'standard', label: 'Standard', description: 'Balanced width' },
  { id: 'wide', label: 'Wide', description: 'Most detail' },
];

export interface CommandBarFontOption {
  id: CommandBarFontFamily;
  label: string;
  description: string;
  stack: string;
  sample: string;
}

export const commandBarFonts: CommandBarFontOption[] = [
  {
    id: 'open-sans',
    label: 'Open Sans',
    description: 'Balanced and familiar',
    stack: '"Keybar Open Sans", sans-serif',
    sample: 'aG 01',
  },
  {
    id: 'outfit',
    label: 'Outfit',
    description: 'Rounded and playful',
    stack: '"Keybar Outfit", sans-serif',
    sample: 'aG 01',
  },
  {
    id: 'nunito-sans',
    label: 'Nunito Sans',
    description: 'Warm and soft',
    stack: '"Keybar Nunito Sans", sans-serif',
    sample: 'aG 01',
  },
  {
    id: 'sora',
    label: 'Sora',
    description: 'Distinct and geometric',
    stack: '"Keybar Sora", sans-serif',
    sample: 'aG 01',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    description: 'Code inspired, slightly smaller',
    stack: '"Keybar IBM Plex Mono", monospace',
    sample: 'aG 01',
  },
];

export const defaultThemePreferences: ThemePreferences = {
  appearance: 'system',
  palette: plain.id,
  size: 'compact',
  windowMode: 'expanded',
  fontFamily: 'open-sans',
};

export const themePreferencesStorageKey = 'themePreferences';

const THEME_CACHE_KEY = 'command-center-theme-cache';

export const normalizeThemePreferences = (value: unknown): ThemePreferences => {
  if (!value || typeof value !== 'object') {
    return defaultThemePreferences;
  }

  const candidate = value as Partial<ThemePreferences>;
  const appearance: AppearanceMode =
    candidate.appearance === 'light' || candidate.appearance === 'dark' ? candidate.appearance : 'system';

  const legacyPaletteIds: Record<string, string> = {
    raycast: 'plain',
    slate: 'plain',
    clay: 'tobacco',
    fjord: 'nordic',
    moss: 'plain',
    claude: 'tobacco',
    abyss: 'aurora',
    'night-blue': 't3-ocean',
    'solarized-dark': 't3-ocean',
    'solarized-light': 'tobacco',
    'cursor-light': 't3-code',
    'vscode-dark-modern': 'vscode-dark-vs',
    brutalist: 'plain',
    sakura: 'catppuccin',
    chalk: 't3-code',
    parchment: 'tobacco',
  };

  const requestedPalette =
    typeof candidate.palette === 'string'
      ? (legacyPaletteIds[candidate.palette] ?? candidate.palette)
      : defaultThemePreferences.palette;

  const palette = themeRegistry.some((theme) => theme.id === requestedPalette)
    ? requestedPalette
    : defaultThemePreferences.palette;

  const size = commandBarSizes.some((option) => option.id === candidate.size)
    ? candidate.size!
    : defaultThemePreferences.size;

  const windowMode: CommandBarWindowMode = candidate.windowMode === 'compact' ? 'compact' : 'expanded';
  const fontFamily = commandBarFonts.some((option) => option.id === candidate.fontFamily)
    ? candidate.fontFamily!
    : defaultThemePreferences.fontFamily;

  return { appearance, palette, size, windowMode, fontFamily };
};

export const readThemeCache = (): ThemePreferences => {
  try {
    const stored = localStorage.getItem(THEME_CACHE_KEY);
    return normalizeThemePreferences(stored ? JSON.parse(stored) : null);
  } catch {
    return defaultThemePreferences;
  }
};

export const cacheThemePreferences = (preferences: ThemePreferences): void => {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(preferences));
  } catch {
    // The persistent Chrome storage value remains the source of truth.
  }
};

export const applyTheme = (
  preferences: ThemePreferences,
  systemDark: boolean,
  root: HTMLElement = document.documentElement,
): void => {
  const theme = themeRegistry.find((candidate) => candidate.id === preferences.palette) ?? plain;
  const isDark = preferences.appearance === 'dark' || (preferences.appearance === 'system' && systemDark);
  const tokens = isDark ? theme.dark : theme.light;

  root.dataset.appearance = isDark ? 'dark' : 'light';
  root.dataset.palette = theme.id;
  root.dataset.size = preferences.size;
  root.dataset.windowMode = preferences.windowMode;
  root.dataset.fontFamily = preferences.fontFamily;

  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
};
