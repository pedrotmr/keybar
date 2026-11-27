import { useLayoutEffect, useRef } from 'react';
import { reportActivationBenchmarkStage } from '@/utils/coldActivationBenchmark';
import type { ActivationBenchmarkSurface } from '@/utils/coldActivationBenchmark';
import type { SurfaceController, SurfaceRenderer } from '../types';
import { useOverlayFrame } from './useOverlayFrame';

interface OverlayFrameProps {
  controller: SurfaceController;
  renderSurface: SurfaceRenderer;
}

export function OverlayFrame({ controller, renderSurface }: OverlayFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const {
    isOpen,
    theme,
    closeSurface,
    autoSwitchOnRelease,
    openedAt,
    modifierReleasedAtOpen,
    releaseKey,
    cycleVersion,
    tabsSnapshot,
  } = useOverlayFrame(controller);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const surface: ActivationBenchmarkSurface = controller.surface === 'tabs' ? 'tab-switcher' : 'command-bar';
    return reportActivationBenchmarkStage('surfaceRendered', surface, stageRef.current);
  }, [controller.surface, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div ref={stageRef} className="cc-overlay-stage">
      <div className="cc-overlay-backdrop" aria-hidden="true" onClick={closeSurface} />
      {renderSurface({
        theme,
        themeRoot: controller.host,
        onClose: closeSurface,
        tabsSnapshot,
        autoSwitchOnRelease,
        openedAt,
        modifierReleasedAtOpen,
        releaseKey,
        cycleVersion,
      })}
    </div>
  );
}
