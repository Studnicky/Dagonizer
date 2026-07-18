/**
 * main.ts: browser entrypoint for the standalone Cartographer demo.
 *
 * Mounts the same `CartographerRunner.vue` component the docs site renders
 * at `docs/examples/the-cartographer`, so the standalone app and the docs
 * page are the same code running two different hosts. All Cartographer
 * orchestration (streaming shipment-tracking pipeline, worker-pool
 * dispatch, geo resolution, GDPR redaction, live DAG visualization) lives
 * in that component and the sub-DAGs / worker registry it wires up.
 *
 * The runner takes no props — it is a self-contained, deterministic,
 * offline pipeline; the visitor configures the run entirely through the
 * Configuration tab and clicks Run.
 */

import { createApp, h } from 'vue';
import CartographerRunner from './app/CartographerRunner.vue';

createApp({ 'render': () => h(CartographerRunner) }).mount('#app');
