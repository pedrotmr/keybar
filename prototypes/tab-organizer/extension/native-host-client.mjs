import { ANALYSIS_REQUEST_TIMEOUT_MS } from './shared/timeouts.mjs';
import { NativeHostAction, NativeHostEvent } from './shared/protocol.mjs';

export function createNativeHostClient({ connect, lastError, idleMs = 60_000 }) {
  let port;
  let idleTimer;
  let nextId = 0;
  const pending = new Map();

  function close(error = new Error('The local AI host disconnected. Try again.')) {
    clearTimeout(idleTimer);
    const previous = port;
    port = undefined;
    for (const id of [...pending.keys()]) finish(id, error);
    previous?.disconnect();
  }

  function finish(id, error, data) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timeout);
    request.signal?.removeEventListener('abort', request.abort);
    if (request.signal?.aborted) request.reject(new Error('Analysis cancelled. No tabs were changed.'));
    else if (error) request.reject(error);
    else request.resolve(data);
    if (!pending.size && port) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => close(), idleMs);
    }
  }

  function connection() {
    if (port) return port;
    const opened = connect();
    port = opened;
    opened.onMessage.addListener((reply) => {
      if (port !== opened) return;
      if (!Number.isSafeInteger(reply?.id)) {
        close(new Error('The local AI host returned an incompatible reply. Reload the prototype extension.'));
        return;
      }
      if (reply.event === NativeHostEvent.progress) {
        const request = pending.get(reply.id);
        if (request && !request.signal?.aborted) {
          try {
            request.onProgress?.(reply.data);
          } catch {
            /* A preview cannot replace the final reply. */
          }
        }
        return;
      }
      finish(reply.id, reply.ok ? undefined : new Error(reply.error || 'The local AI request failed.'), reply.data);
    });
    opened.onDisconnect.addListener(() => {
      const detail = lastError?.();
      if (port !== opened) return;
      close(
        new Error(
          detail
            ? `Local AI host failed (${detail}). Follow the prototype README setup steps.`
            : 'The local AI host disconnected before replying. No tabs were changed; try again.',
        ),
      );
    });
    return opened;
  }

  function request(payload, { signal, onProgress, timeoutMs = ANALYSIS_REQUEST_TIMEOUT_MS } = {}) {
    if (signal?.aborted) return Promise.reject(new Error('Analysis cancelled. No tabs were changed.'));
    clearTimeout(idleTimer);
    let activePort;
    try {
      activePort = connection();
    } catch {
      return Promise.reject(new Error('Local AI host is unavailable. Follow the prototype README setup steps.'));
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        try {
          activePort.postMessage({ action: NativeHostAction.cancelAnalysis, targetId: id });
        } catch {
          close(new Error('The local AI host could not receive the cancellation. Try again.'));
        }
      };
      const timeout = setTimeout(() => {
        close(new Error('The local AI host did not reply in time. No tabs were changed; try again.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout, signal, abort, onProgress });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        activePort.postMessage({ ...payload, id });
      } catch {
        close(new Error('The local AI host could not receive the request. Try again.'));
      }
    });
  }

  return { request, close };
}
