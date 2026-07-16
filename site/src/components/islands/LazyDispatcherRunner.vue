<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const DispatcherRunner = defineAsyncComponent(() => import('../../../../examples/the-dispatcher/app/DispatcherRunner.vue'));
</script>

<template>
  <DispatcherRunner />
</template>
