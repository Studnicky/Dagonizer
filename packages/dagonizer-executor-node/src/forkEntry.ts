/**
 * forkEntry: child_process.fork / node:cluster bootstrap.
 *
 * Wraps the process IPC endpoint in an IpcChannel and starts a DagHost.
 * Used by both ForkContainer and ClusterContainer as their exec/script target.
 *
 * Referenced from ForkContainer / ClusterContainer as:
 *   new URL('./forkEntry.js', import.meta.url)
 */

import { DagHost } from '@noocodex/dagonizer/container';

import { IpcChannel } from './IpcChannel.js';

const sendFn = process.send?.bind(process);
if (sendFn === undefined) {
  throw new Error('forkEntry: process.send is undefined — this file must run as a forked child process');
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
