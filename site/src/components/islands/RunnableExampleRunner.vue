<script setup lang="ts">
import RunnableExampleMount from '../../../../examples/runnable-example/RunnableExampleMount.vue';
import type { RunnableExampleId } from './runnableExampleContext';

withDefaults(defineProps<{
  example: RunnableExampleId;
  runnerProps?: Readonly<Record<string, unknown>>;
}>(), {
  'runnerProps': () => ({}),
});
</script>

<template>
  <RunnableExampleMount :example="example" :runner-props="runnerProps" />
</template>
