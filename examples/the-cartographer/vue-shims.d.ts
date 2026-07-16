/**
 * vue-shims.d.ts: ambient module declaration for `.vue` single-file
 * components under plain `tsc` (this package's `typecheck` script).
 *
 * `main.ts` imports `./app/CartographerRunner.vue` directly; `tsc` has no
 * SFC loader, so it needs this shim to resolve the import. The component's
 * internal `<script setup>` contents are typechecked separately by
 * `vue-tsc` via `npm run typecheck:docs`, which reaches this file through
 * the docs runner's import graph.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
