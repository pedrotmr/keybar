import type { SurfaceController, SurfaceRenderer } from '../types';
import { useOverlayFrame } from './useOverlayFrame';

interface OverlayFrameProps {
  controller: SurfaceController;
  renderSurface: SurfaceRenderer;
}

export function OverlayFrame({ controller, renderSurface }: OverlayFrameProps) {
  const {
    isOpen,
    theme,
    closeSurface,
    autoSwitchOnRelease,
    openedAt,
    modifierReleasedAtOpen,
    releaseKey,
    cycleVersion,
  } = useOverlayFrame(controller);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="cc-overlay-stage">
      <div className="cc-overlay-backdrop" aria-hidden="true" onClick={closeSurface} />
      {renderSurface({
        theme,
        themeRoot: controller.host,
        onClose: closeSurface,
        autoSwitchOnRelease,
        openedAt,
        modifierReleasedAtOpen,
        releaseKey,
        cycleVersion,
      })}
    </div>
  );
}
