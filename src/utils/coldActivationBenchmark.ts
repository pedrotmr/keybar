export type ActivationBenchmarkSurface = 'command-bar' | 'tab-switcher';
export type ActivationBenchmarkStage = 'surfaceRendered' | 'firstResultVisible';

export const activationBenchmarkAttribute = 'data-keybar-activation-benchmark';
export const activationBenchmarkStageEvent = 'keybar:activation-benchmark-stage';

const isBenchmarkFixture = (): boolean =>
  import.meta.env.MODE.startsWith('activation-benchmark') &&
  typeof document !== 'undefined' &&
  document.documentElement.hasAttribute(activationBenchmarkAttribute);

export const setActivationBenchmarkStart = (host: HTMLElement, startedAt: number): void => {
  if (isBenchmarkFixture() && Number.isFinite(startedAt)) {
    host.setAttribute('data-keybar-activation-started-at', String(startedAt));
  }
};

const isPainted = (element: HTMLElement): boolean => {
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

  const checkPaint = (): void => {
    framesChecked += 1;

    if (cancelled || !element.isConnected || framesChecked > 120) {
      return;
    }

    if (isPainted(element)) {
      if (
        stage === 'firstResultVisible' &&
        !document.documentElement.hasAttribute('data-keybar-benchmark-result-visible-at')
      ) {
        document.documentElement.setAttribute(
          'data-keybar-benchmark-result-visible-at',
          String(performance.timeOrigin + performance.now()),
        );
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

    frame = window.requestAnimationFrame(checkPaint);
  };

  frame = window.requestAnimationFrame(checkPaint);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
};
