<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  title: string;
}>();
</script>

<template>
  <Card>
    <template #subtitle>{{ title }}</template>
    <template #content>
      <slot />
    </template>
  </Card>
</template>
