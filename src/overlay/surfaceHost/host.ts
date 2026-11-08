import type { CreatedOverlayHost, SurfaceController } from './types';

export const setPageInert = (controller: SurfaceController, inert: boolean): void => {
  if (inert) {
    const body = document.body;

    if (!body || controller.pageInertState?.body === body) {
      return;
    }

    setPageInert(controller, false);
    controller.pageInertState = { body, wasInert: body.inert };
    body.inert = true;
    return;
  }

  const previous = controller.pageInertState;

  if (!previous) {
    return;
  }

  if (previous.body.isConnected && previous.body.inert) {
    previous.body.inert = previous.wasInert;
  }

  controller.pageInertState = null;
};

export const showHost = (host: HTMLElement): void => {
  host.style.setProperty('display', 'block', 'important');

  try {
    if (!host.matches(':popover-open')) {
      host.showPopover();
    }
  } catch {
    host.removeAttribute('popover');
  }
};

export const hideHost = (host: HTMLElement): void => {
  try {
    if (host.matches(':popover-open')) {
      host.hidePopover();
    }
  } catch {
    host.removeAttribute('popover');
  }

  host.style.setProperty('display', 'none', 'important');
};

export const createHost = (hostId: string, styles: string): CreatedOverlayHost => {
  const host = document.createElement('div');
  host.id = hostId;
  host.setAttribute('popover', 'manual');

  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('width', '100vw', 'important');
  host.style.setProperty('height', '100vh', 'important');

  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('display', 'none', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('opacity', '1', 'important');

  host.style.setProperty('overflow', 'visible', 'important');
  host.style.setProperty('transform', 'none', 'important');
  host.style.setProperty('filter', 'none', 'important');
  host.style.setProperty('clip', 'auto', 'important');
  host.style.setProperty('clip-path', 'none', 'important');

  host.style.setProperty('isolation', 'isolate', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  host.style.setProperty('contain', 'layout style paint', 'important');

  host.style.setProperty('background', 'transparent', 'important');
  host.style.setProperty('margin', '0', 'important');
  host.style.setProperty('padding', '0', 'important');
  host.style.setProperty('border', '0', 'important');
  host.style.setProperty('box-sizing', 'border-box', 'important');

  host.style.setProperty('direction', 'ltr', 'important');
  host.style.setProperty('unicode-bidi', 'isolate', 'important');
  document.documentElement.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'closed' });
  shadowRoot.addEventListener('keydown', (event) => event.stopPropagation());

  const stopUnmodifiedPrintableKeyboardPropagation = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;

    if (keyboardEvent.key.length !== 1 || keyboardEvent.altKey || keyboardEvent.ctrlKey || keyboardEvent.metaKey) {
      return;
    }

    event.stopPropagation();
  };

  shadowRoot.addEventListener('keypress', stopUnmodifiedPrintableKeyboardPropagation);
  shadowRoot.addEventListener('keyup', stopUnmodifiedPrintableKeyboardPropagation);

  const style = document.createElement('style');
  style.textContent = styles;
  const mountPoint = document.createElement('div');
  mountPoint.className = 'cc-extension-root';
  shadowRoot.addEventListener(
    'wheel',
    (event) => {
      const wheelEvent = event as WheelEvent;

      if (wheelEvent.ctrlKey) {
        return;
      }

      const target = wheelEvent.target instanceof Element ? wheelEvent.target : null;
      const horizontal = Math.abs(wheelEvent.deltaX) > Math.abs(wheelEvent.deltaY);
      const delta = horizontal ? wheelEvent.deltaX : wheelEvent.deltaY;
      let current: Element | null = target;

      while (current) {
        if (
          current instanceof HTMLElement &&
          current.matches('.results-list, .settings-view, .flow-dialog, .action-dock-menu')
        ) {
          const position = horizontal ? current.scrollLeft : current.scrollTop;
          const extent = horizontal
            ? current.scrollWidth - current.clientWidth
            : current.scrollHeight - current.clientHeight;

          const canScroll = delta < 0 ? position > 0 : position < extent - 1;

          if (canScroll) {
            return;
          }
        }

        current = current.parentElement;
      }

      wheelEvent.preventDefault();
    },
    { capture: true, passive: false },
  );
  shadowRoot.append(style, mountPoint);

  return { host, mountPoint };
};
