/**
 * spawnEntry: spawn bootstrap for NDJSON-over-stdio transport.
 *
 * Wraps process.stdin / process.stdout in an NdjsonChannel and starts a
 * DagHost. This is the default entry for SpawnContainer.
 *
 * Any runtime that can read NDJSON from stdin and write NDJSON to stdout can
 * replace this module — Python, Bun, a compiled binary — as long as it speaks
 * the BridgeMessage protocol. SpawnContainer's `command`/`args` options allow
 * overriding the entry for polyglot workers.
 *
 * Referenced from SpawnContainer as:
 *   new URL('./spawnEntry.js', import.meta.url)
 */

import { DagHost } from '@noocodex/dagonizer/container';

import { NdjsonChannel } from './NdjsonChannel.js';

const channel = new NdjsonChannel(process.stdin, process.stdout);
const host = new DagHost(channel);
host.start();
