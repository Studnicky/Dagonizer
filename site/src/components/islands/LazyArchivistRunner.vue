<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const ArchivistRunner = defineAsyncComponent(() => import('../../../../examples/the-archivist/app/ArchivistRunner.vue'));
</script>

<template>
  <ArchivistRunner />
</template>
