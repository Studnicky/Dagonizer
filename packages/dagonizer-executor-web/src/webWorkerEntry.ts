/**
 * webWorkerEntry: worker-side bootstrap for the bridge protocol.
 *
 * `WebWorkerEntry.start(scope)` wraps a WorkerScopeLikeInterface in a
 * PostMessageChannel and starts a DagHost. The scope is always injected
 * — this module never references `self` at module top-level, keeping it
 * side-effect-free and importable in test environments.
 *
 * Consumer usage (inside the worker file):
 *
 *   // worker.ts (consumer's file — they own the cast at THEIR boundary)
 *   import { WebWorkerEntry } from '@studnicky/dagonizer-executor-web';
 *   import type { WorkerScopeLikeInterface } from '@studnicky/dagonizer-executor-web';
 *
 *   WebWorkerEntry.start(self as unknown as WorkerScopeLikeInterface);
 *
 * The `as unknown as WorkerScopeLikeInterface` cast lives in the consumer's
 * worker file because `self` (DedicatedWorkerGlobalScope) is a DOM type.
 * This package never depends on DOM lib types.
 */

import { DagHost } from '@studnicky/dagonizer/container';
import type { RegistryModuleInterface } from '@studnicky/dagonizer/contracts';

import { PostMessageChannel } from './PostMessageChannel.js';
import type { WorkerScopeLikeInterface } from './WebWorkerLike.js';

// ---------------------------------------------------------------------------
// WebWorkerEntry
// ---------------------------------------------------------------------------

export class WebWorkerEntry {
  private constructor() { /* static class */ }

  /**
   * Bootstrap a DagHost inside a worker.
   *
   * Wraps `scope` in a PostMessageChannel and starts the DagHost message
   * loop. The DagHost handles all further protocol messages
   * (init → execute → abort → shutdown).
   *
   * Returns the DagHost so callers can hold a reference if needed for
   * testing or advanced lifecycle management.
   *
   * `registry` statically injects the isolate registry so the host runs no
   * dynamic import. Omit it to import the init `registryModule` by URL.
   */
  static start(scope: WorkerScopeLikeInterface, registry?: RegistryModuleInterface): DagHost {
    const channel = new PostMessageChannel(scope);
    const host = new DagHost(channel, registry !== undefined ? { 'registry': registry } : {});
    host.start();
    return host;
  }
}
