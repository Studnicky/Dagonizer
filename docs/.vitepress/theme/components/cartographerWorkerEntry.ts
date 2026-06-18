/**
 * cartographerWorkerEntry: web-worker bootstrap for the Cartographer scatter
 * body. The registry is statically imported and injected, so the DagHost runs
 * no dynamic import. Instantiated from CartographerRunner via
 * `new Worker(new URL('./cartographerWorkerEntry.ts', import.meta.url), { type: 'module' })`.
 */

import { WebWorkerEntry } from '@studnicky/dagonizer-executor-web';
import type { WorkerScopeLikeInterface } from '@studnicky/dagonizer-executor-web';

import cartographerRegistry from './cartographerWorkerRegistry.ts';

WebWorkerEntry.start(self as unknown as WorkerScopeLikeInterface, cartographerRegistry);
