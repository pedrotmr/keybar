export type ActivationBenchmarkSurface = 'command-bar' | 'tab-switcher';
export type ActivationBenchmarkStage = 'surfaceFocused' | 'surfaceRendered' | 'firstResultAfterPaintOpportunity';

export const activationBenchmarkAttribute = 'data-keybar-activation-benchmark';
export const activationBenchmarkStageEvent = 'keybar:activation-benchmark-stage';
export const isActivationBenchmarkBuild =
  import.meta.env.MODE === 'activation-benchmark' || import.meta.env.MODE === 'activation-benchmark-baseline';

const isBenchmarkFixture = (): boolean =>
  isActivationBenchmarkBuild &&
  typeof document !== 'undefined' &&
  document.documentElement.hasAttribute(activationBenchmarkAttribute);

const isVisibleForPaint = (element: HTMLElement): boolean => {
  const bounds = element.getBoundingClientRect();
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.bottom <= 0 ||
    bounds.right <= 0 ||
    bounds.top >= window.innerHeight ||
    bounds.left >= window.innerWidth
  ) {
    return false;
  }

  let current: Element | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) {
      return false;
    }

    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }

    const root = current.getRootNode();
    current = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.host : null;
  }

  return true;
};

export const reportActivationBenchmarkStage = (
  stage: ActivationBenchmarkStage,
  surface: ActivationBenchmarkSurface,
  element: HTMLElement | null,
): (() => void) => {
  if (!isBenchmarkFixture() || !element) {
    return () => undefined;
  }

  let cancelled = false;
  let frame = 0;
  let framesChecked = 0;
  let visibleFrames = 0;

  const checkPaint = (): void => {
    framesChecked += 1;

    if (cancelled || !element.isConnected || framesChecked > 120) {
      return;
    }

    if (isVisibleForPaint(element)) {
      visibleFrames += 1;
      const requiredFrames = stage === 'firstResultAfterPaintOpportunity' ? 2 : 1;
      if (visibleFrames < requiredFrames) {
        frame = window.requestAnimationFrame(checkPaint);
        return;
      }

      const resultMarker = 'data-keybar-benchmark-result-after-paint-opportunity-at';
      if (stage === 'firstResultAfterPaintOpportunity' && document.documentElement.hasAttribute(resultMarker)) {
        return;
      }
      if (stage === 'firstResultAfterPaintOpportunity') {
        document.documentElement.setAttribute(resultMarker, String(performance.now()));
      }
      window.dispatchEvent(
        new CustomEvent(activationBenchmarkStageEvent, {
          bubbles: true,
          composed: true,
          detail: { stage, surface },
        }),
      );
      return;
    }

    visibleFrames = 0;
    frame = window.requestAnimationFrame(checkPaint);
  };

  frame = window.requestAnimationFrame(checkPaint);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
};
