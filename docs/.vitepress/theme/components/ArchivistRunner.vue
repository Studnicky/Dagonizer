<script setup lang="ts">
/**
 * ArchivistRunner: docs-side thin wrapper.
 *
 * The Archivist runner component lives at
 * `examples/the-archivist/app/ArchivistRunner.vue` so the standalone Vite
 * demo and the docs page render the identical component. This wrapper
 * exists only so `docs/.vitepress/theme/index.ts` can lazy-load it from a
 * stable in-tree path.
 */
import ArchivistRunner from '../../../../examples/the-archivist/app/ArchivistRunner.vue';
</script>

<template>
  <ArchivistRunner />
</template>
