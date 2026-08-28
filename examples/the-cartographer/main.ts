/**
 * main.ts: browser entrypoint for the standalone Cartographer demo.
 *
 * Boots the same shared runnable-example host the Astro site and VitePress
 * docs use, so stale browser context recovery and the Vue mount path stay
 * identical across every host. All Cartographer orchestration (streaming
 * shipment-tracking pipeline, worker-pool dispatch, geo resolution, GDPR
 * redaction, live DAG visualization) still lives in `CartographerRunner.vue`.
 *
 * The runner takes no props — it is a self-contained, deterministic,
 * offline pipeline; the visitor configures the run entirely through the
 * Configuration tab and clicks Run.
 */

import { mountStandaloneRunnableExample } from '../runnable-example/standaloneRunnableExample.ts';

mountStandaloneRunnableExample('cartographer');
