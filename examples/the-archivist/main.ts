/**
 * main.ts: browser entrypoint for the standalone Archivist demo.
 *
 * Mounts the same `ArchivistRunner.vue` component the docs site renders at
 * `docs/examples/the-archivist`, so the standalone app and the docs page are
 * the same code running two different hosts. All Archivist orchestration
 * (provider matrix, HITL park/resume, checkpoint save/resume, memory graph,
 * DAG visualization) lives in that component and the `ArchivistSession` base
 * class it extends.
 *
 * URL params, forwarded to `ArchivistRunner` as props:
 *   ?apiKey=<key>        Gemini API key for the REST adapter; saved into local config.
 *   ?lang=<tag>          Override browser language detection (e.g. ?lang=fr).
 *   ?park                Skip the greeting/sample-reply bootstrap; park immediately.
 *   ?webLlmModel=<id>    Persist the preferred WebLLM prebuilt model.
 *
 * Ollama CORS caveat: start the daemon with
 * `OLLAMA_ORIGINS='http://localhost:5174' ollama serve` (or `OLLAMA_ORIGINS='*'`)
 * to allow cross-origin requests from this harness.
 */

import { createApp } from 'vue';

import ArchivistRunner from './app/ArchivistRunner.vue';

const params = new URLSearchParams(window.location.search);

createApp(ArchivistRunner, {
  'apiKey':      params.get('apiKey') ?? '',
  'lang':        params.get('lang') ?? '',
  'park':        params.has('park'),
  'webLlmModel': params.get('webLlmModel') ?? '',
}).mount('#app');
