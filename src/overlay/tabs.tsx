import { createElement } from 'react';
import { TabSwitcher } from '@/components/TabSwitcher';
import { mountOverlaySurface } from './surfaceHost/mountOverlaySurface';
import styleText from '@/styles/global.css?inline';

mountOverlaySurface(
  'tabs',
  styleText,
  ({ onClose, autoSwitchOnRelease, openedAt, modifierReleasedAtOpen, releaseKey, cycleVersion }) =>
    createElement(TabSwitcher, {
      onClose,
      autoSwitchOnRelease,
      openedAt,
      modifierReleasedAtOpen,
      releaseKey,
      surface: 'overlay',
      cycleVersion,
    }),
);
