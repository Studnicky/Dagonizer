/**
 * workerEntry: worker_threads bootstrap.
 *
 * `WorkerEntry.start()` wraps parentPort in a MessagePortChannel and starts a
 * DagHost over it. The bootstrap is encapsulated in a static class so it is
 * importable and testable; `WorkerEntry.start()` is called at the bottom of
 * this file so it still works as a `node workerEntry.js` exec target.
 *
 * Referenced from WorkerThreadContainer as:
 *   new URL('./workerEntry.js', import.meta.url)
 */

import { isMainThread, parentPort } from 'node:worker_threads';

import { DagHost } from '@noocodex/dagonizer/container';

import { MessagePortChannel } from './MessagePortChannel.js';

// ---------------------------------------------------------------------------
// WorkerEntry
// ---------------------------------------------------------------------------

export class WorkerEntry {
  private constructor() { /* static class */ }

  /**
   * Bootstrap a DagHost inside a worker thread.
   *
   * Wraps `parentPort` in a MessagePortChannel and starts the DagHost message
   * loop. Throws when called outside a worker thread (parentPort null).
   *
   * Returns the DagHost so callers can hold a reference if needed for
   * testing or advanced lifecycle management.
   */
  static start(): DagHost {
    if (parentPort === null) {
      throw new Error('WorkerEntry.start: parentPort is null — this file must run as a worker thread');
    }

    const channel = new MessagePortChannel(parentPort);
    const host = new DagHost(channel);
    host.start();
    return host;
  }
}

// Auto-start only inside a worker thread (new Worker(workerEntry.js) under
// WorkerThreadContainer). Importing this module via the package barrel on the
// main thread leaves isMainThread true, so the bootstrap is skipped.
if (!isMainThread) {
  WorkerEntry.start();
}
