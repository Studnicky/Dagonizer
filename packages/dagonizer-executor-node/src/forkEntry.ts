/**
 * forkEntry: child_process.fork / node:cluster bootstrap.
 *
 * `ForkEntry.start()` wraps the process IPC endpoint in an IpcChannel and
 * starts a DagHost. The bootstrap is encapsulated in a static class so it is
 * importable and testable; `ForkEntry.start()` is called at the bottom of this
 * file so it still works as a `node forkEntry.js` exec target.
 *
 * Referenced from ForkContainer / ClusterContainer as:
 *   new URL('./forkEntry.js', import.meta.url)
 */

import { DagHost } from '@noocodex/dagonizer/container';

import { IpcChannel } from './IpcChannel.js';

// ---------------------------------------------------------------------------
// ForkEntry
// ---------------------------------------------------------------------------

export class ForkEntry {
  private constructor() { /* static class */ }

  /**
   * Bootstrap a DagHost inside a forked child process.
   *
   * Wraps the process IPC channel in an IpcChannel and starts the DagHost
   * message loop. Throws when called outside a forked child (process.send
   * undefined).
   *
   * Returns the DagHost so callers can hold a reference if needed for
   * testing or advanced lifecycle management.
   */
  static start(): DagHost {
    const sendFn = process.send?.bind(process);
    if (sendFn === undefined) {
      throw new Error('ForkEntry.start: process.send is undefined — this file must run as a forked child process');
    }

    const endpoint = {
      'send': (message: unknown): void => { sendFn(message); },
      'on': (event: 'message', listener: (message: unknown) => void) => {
        process.on(event, listener);
        return endpoint;
      },
    };

    const channel = new IpcChannel(endpoint);
    const host = new DagHost(channel);
    host.start();
    return host;
  }
}

// Auto-start only when running as a forked/cluster child, where the IPC channel
// is present (process.send defined). Importing this module via the package
// barrel in a non-fork process leaves process.send undefined, so the bootstrap
// is skipped rather than throwing.
if (process.send !== undefined) {
  ForkEntry.start();
}
