/**
 * main.ts: browser entrypoint for the standalone Dispatcher demo.
 *
 * Boots the same shared runnable-example host the Astro site and VitePress
 * docs use, so stale browser context recovery and the Vue mount path stay
 * identical across every host. All Dispatcher orchestration (provider
 * matrix, classify/compose/decline/park routing, HITL operator handoff,
 * checkpoint resume, DAG visualization) still lives in `DispatcherRunner.vue`.
 *
 * Ollama CORS caveat: start the daemon with
 * `OLLAMA_ORIGINS='http://localhost:5175' ollama serve` (or `OLLAMA_ORIGINS='*'`)
 * to allow cross-origin requests from this harness.
 */

import { mountStandaloneRunnableExample } from '../runnable-example/standaloneRunnableExample.ts';

mountStandaloneRunnableExample('dispatcher');
