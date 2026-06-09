/**
 * workerEntry: worker_threads bootstrap.
 *
 * Wraps parentPort in a MessagePortChannel and starts a DagHost over it.
 * This module is the entry point for workers spawned by WorkerThreadContainer.
 *
 * Referenced from WorkerThreadContainer as:
 *   new URL('./workerEntry.js', import.meta.url)
 */

import { parentPort } from 'node:worker_threads';

import { DagHost } from '@noocodex/dagonizer/container';

import { MessagePortChannel } from './MessagePortChannel.js';

if (parentPort === null) {
  throw new Error('workerEntry: parentPort is null — this file must run as a worker thread');
}

const channel = new MessagePortChannel(parentPort);
const host = new DagHost(channel);
host.start();
