import { createElement } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { mountOverlaySurface } from './surfaceHost/mountOverlaySurface';
import styleText from '@/styles/global.css?inline';

mountOverlaySurface('commands', styleText, ({ theme, themeRoot, onClose, tabsSnapshot }) =>
  createElement(CommandPalette, {
    initialMode: 'commands',
    initialTheme: theme,
    themeRoot,
    cacheThemeInLocalStorage: false,
    onClose,
    surface: 'overlay',
    initialTabsSnapshot: tabsSnapshot,
  }),
);
