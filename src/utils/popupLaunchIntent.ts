import { isTabSwitcherModifierKey, type TabSwitcherReleaseKey } from './tabSwitcherKeyRelease';

export type PopupLaunchMode = 'commands' | 'tabs';

export interface PopupLaunchIntent {
  mode: PopupLaunchMode;
  autoSwitchOnRelease: boolean;
  openedAt: number;
  releaseKey?: TabSwitcherReleaseKey | null;
}

const modeKey = 'nextPaletteMode';
const autoSwitchKey = 'nextTabSwitcherAutoSwitchOnRelease';
const releaseModifierKey = 'nextTabSwitcherReleaseKey';
const openedAtKey = 'paletteRequestedAt';
const intentKeys = [modeKey, autoSwitchKey, releaseModifierKey, openedAtKey] as const;

export const writePopupLaunchIntent = async (intent: PopupLaunchIntent): Promise<void> => {
  await chrome.storage.session.set({
    [modeKey]: intent.mode,
    [autoSwitchKey]: intent.autoSwitchOnRelease,
    [releaseModifierKey]: intent.releaseKey ?? null,
    [openedAtKey]: intent.openedAt,
  });
};

export const consumePopupLaunchIntent = async (): Promise<Partial<PopupLaunchIntent>> => {
  const stored = await chrome.storage.session.get([...intentKeys]);
  await chrome.storage.session.remove([...intentKeys]).catch(() => undefined);

  const mode = stored[modeKey];
  const openedAt = stored[openedAtKey];

  return {
    mode: mode === 'commands' || mode === 'tabs' ? mode : undefined,
    autoSwitchOnRelease: stored[autoSwitchKey] === true,
    releaseKey: isTabSwitcherModifierKey(stored[releaseModifierKey]) ? stored[releaseModifierKey] : null,
    openedAt: typeof openedAt === 'number' && openedAt > 0 ? openedAt : undefined,
  };
};

export const parsePopupLaunchFallback = (parameters: URLSearchParams): PopupLaunchIntent | null => {
  const mode = parameters.get('mode');
  const openedAt = Number(parameters.get('openedAt'));

  if ((mode !== 'commands' && mode !== 'tabs') || !Number.isFinite(openedAt) || openedAt <= 0) {
    return null;
  }

  return { mode, openedAt, autoSwitchOnRelease: false, releaseKey: null };
};
