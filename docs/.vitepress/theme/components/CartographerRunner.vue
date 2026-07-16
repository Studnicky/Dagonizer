<script setup lang="ts">
/**
 * CartographerRunner: docs-side thin wrapper.
 *
 * The Cartographer runner component lives at
 * `examples/the-cartographer/app/CartographerRunner.vue` so the standalone
 * Vite demo and the docs page render the identical component. This wrapper
 * exists only so `docs/.vitepress/theme/index.ts` can lazy-load it from a
 * stable in-tree path.
 */
import CartographerRunner from '../../../../examples/the-cartographer/app/CartographerRunner.vue';
</script>

<template>
  <CartographerRunner />
</template>
