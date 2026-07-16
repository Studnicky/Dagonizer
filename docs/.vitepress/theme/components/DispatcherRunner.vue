<script setup lang="ts">
/**
 * DispatcherRunner: docs-side thin wrapper.
 *
 * The Dispatcher runner component lives at
 * `examples/the-dispatcher/app/DispatcherRunner.vue` so the standalone Vite
 * demo and the docs page render the identical component. This wrapper
 * exists only so `docs/.vitepress/theme/index.ts` can lazy-load it from a
 * stable in-tree path.
 */
import DispatcherRunner from '../../../../examples/the-dispatcher/app/DispatcherRunner.vue';
</script>

<template>
  <DispatcherRunner />
</template>
