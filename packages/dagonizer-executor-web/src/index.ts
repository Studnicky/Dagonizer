/**
 * @studnicky/dagonizer-executor-web
 *
 * Browser isolating container backend for @studnicky/dagonizer.
 * Web Worker pool over the bridge protocol. A WebWorkerContainer runs a
 * whole embedded DAG inside a Web Worker isolate.
 *
 * Public exports:
 *   WebWorkerLikeInterface      — structural contract for a main-thread worker endpoint
 *   WorkerScopeLikeInterface    — structural contract for an inside-worker global scope
 *   PostMessageChannel          — MessageChannelInterface over postMessage
 *   PostMessageEndpoint         — union type accepted by PostMessageChannel
 *   WebSystemInfo               — SystemInfoInterface using navigator.hardwareConcurrency
 *   WebSystemInfoProbes         — injected probes for WebSystemInfo
 *   WebWorkerContainer          — DagContainerInterface pool of Web Workers
 *   WebWorkerContainerOptions   — constructor options for WebWorkerContainer
 *   WebWorkerEntry              — worker-side bootstrap (noun.verb static class)
 */

export type {
  WebWorkerLikeInterface,
  WorkerScopeLikeInterface,
} from './WebWorkerLike.js';

export {
  PostMessageChannel,
} from './PostMessageChannel.js';
export type { PostMessageEndpointType } from './PostMessageChannel.js';

export {
  DEFAULT_WEB_PROBES,
  WebSystemInfo,
} from './WebSystemInfo.js';
export type { WebNavigatorProbesType, WebSystemInfoProbesType } from './WebSystemInfo.js';

export {
  WebWorkerContainer,
} from './WebWorkerContainer.js';
export type { WebWorkerContainerOptionsType } from './WebWorkerContainer.js';

export {
  WebWorkerEntry,
} from './webWorkerEntry.js';
