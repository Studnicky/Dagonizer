---
"@studnicky/dagonizer": patch
---

Docs: wrap the interactive browser runners (`ArchivistRunner`, `DispatcherRunner`,
`CartographerRunner`) in `<ClientOnly>`.

These widgets seed initial reactive state from client-only sources at `setup()` —
`Date.now()` (greeting selection), `localStorage` (saved backend, slow-banner,
checkpoint), and `navigator.hardwareConcurrency` (worker pool size). VitePress's
production build statically pre-renders each page, so those build-time values were
baked into the HTML and could never match the values the browser computes on
hydration, producing `Hydration completed but contains mismatches` console errors.
Rendering the runners client-only eliminates the baked markup and the mismatch.
The `DagGraph` embeds are unaffected (deterministic, SSR-safe) and remain SSR'd.
