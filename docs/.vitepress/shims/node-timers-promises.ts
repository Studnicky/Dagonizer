/**
 * Browser shim for `node:timers/promises`.
 *
 * The package's `RealTimeScheduler` imports `node:timers/promises` at
 * module load. Bundling for the browser, Vite has no resolution for
 * the `node:` scheme, so we alias `node:timers/promises` to this file.
 *
 * The Vue runner installs `BrowserScheduler` at mount, so this shim's
 * `setTimeout` is never actually invoked — the alias only exists to
 * satisfy the bundler's static-import graph. Implementing it anyway
 * costs nothing and keeps the surface honest in case anything else
 * imports it later.
 */

interface TimerOptions {
  readonly signal?: AbortSignal;
}

const G = globalThis as {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export function setTimeout<T = void>(
  delay: number,
  value?: T,
  options?: TimerOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted === true) {
      reject(options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error(String(options.signal.reason ?? 'aborted')));
      return;
    }
    const handle = G.setTimeout(() => {
      options?.signal?.removeEventListener('abort', onAbort);
      resolve(value as T);
    }, Math.max(0, delay));
    const onAbort = (): void => {
      G.clearTimeout(handle);
      options?.signal?.removeEventListener('abort', onAbort);
      reject(options?.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error(String(options?.signal?.reason ?? 'aborted')));
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function setImmediate<T = void>(value?: T): Promise<T> {
  return Promise.resolve(value as T);
}
