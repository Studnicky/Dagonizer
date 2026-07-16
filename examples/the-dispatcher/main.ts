/**
 * main.ts: browser entrypoint for the standalone Dispatcher demo.
 *
 * Mounts the same `DispatcherRunner.vue` component the docs site renders at
 * `docs/examples/the-dispatcher`, so the standalone app and the docs page
 * are the same code running two different hosts. All Dispatcher
 * orchestration (provider matrix, classify/compose/decline/park routing,
 * HITL operator handoff, checkpoint resume, DAG visualization) lives in
 * that component and the `supportDispatcherDAG` it builds.
 *
 * Ollama CORS caveat: start the daemon with
 * `OLLAMA_ORIGINS='http://localhost:5175' ollama serve` (or `OLLAMA_ORIGINS='*'`)
 * to allow cross-origin requests from this harness.
 */

import { createApp } from 'vue';

import DispatcherRunner from './app/DispatcherRunner.vue';

createApp(DispatcherRunner).mount('#app');
