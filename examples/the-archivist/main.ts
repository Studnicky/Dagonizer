/**
 * main.ts: browser entrypoint for the standalone Archivist demo.
 *
 * Boots the same shared runnable-example host the Astro site and VitePress
 * docs use, so stale browser context recovery and the Vue mount path stay
 * identical across every host.
 *
 * URL params forwarded to `ArchivistRunner`:
 *   ?apiKey=<key>        Gemini API key for the REST adapter; saved into local config.
 *   ?lang=<tag>          Override browser language detection (e.g. ?lang=fr).
 *   ?park                Skip the greeting/sample-reply bootstrap; park immediately.
 *   ?webLlmModel=<id>    Persist the preferred WebLLM prebuilt model.
 *
 * Ollama CORS caveat: start the daemon with
 * `OLLAMA_ORIGINS='http://localhost:5174' ollama serve` (or `OLLAMA_ORIGINS='*'`)
 * to allow cross-origin requests from this harness.
 */

import { mountStandaloneRunnableExample } from '../runnable-example/standaloneRunnableExample.ts';

mountStandaloneRunnableExample('archivist');
