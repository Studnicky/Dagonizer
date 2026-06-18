/**
 * spawnEntry: spawn bootstrap for NDJSON-over-stdio transport.
 *
 * `SpawnEntry.start()` wraps process.stdin / process.stdout in an NdjsonChannel
 * and starts a DagHost. The bootstrap is encapsulated in a static class so it
 * is importable and testable; `SpawnEntry.start()` is called at the bottom of
 * this file so it still works as a `node spawnEntry.js` exec target.
 *
 * Any runtime that can read NDJSON from stdin and write NDJSON to stdout can
 * replace this module — Python, Bun, a compiled binary — as long as it speaks
 * the BridgeMessage protocol. SpawnContainer's `command`/`args` options allow
 * overriding the entry for polyglot workers.
 *
 * Referenced from SpawnContainer as:
 *   new URL('./spawnEntry.js', import.meta.url)
 */

import { pathToFileURL } from 'node:url';

import { DagHost } from '@studnicky/dagonizer/container';

import { NdjsonChannel } from './NdjsonChannel.js';

// ---------------------------------------------------------------------------
// SpawnEntry
// ---------------------------------------------------------------------------

export class SpawnEntry {
  private constructor() { /* static class */ }

  /**
   * Bootstrap a DagHost inside a spawned child process using NDJSON-over-stdio.
   *
   * Wraps `process.stdin` / `process.stdout` in an NdjsonChannel and starts
   * the DagHost message loop.
   *
   * Returns the DagHost so callers can hold a reference if needed for
   * testing or advanced lifecycle management.
   */
  static start(): DagHost {
    const channel = new NdjsonChannel(process.stdin, process.stdout);
    const host = new DagHost(channel);
    host.start();
    return host;
  }
}

// Auto-start only when this module is the process entrypoint (node spawnEntry.js
// under SpawnContainer). Importing it via the package barrel leaves argv[1]
// pointing at the host's own entry, so the bootstrap is skipped.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  SpawnEntry.start();
}
