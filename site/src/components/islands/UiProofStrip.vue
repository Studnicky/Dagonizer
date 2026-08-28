<script setup lang="ts">
import Tag from 'primevue/tag';

defineProps<{
  label: string;
  detail: string;
}>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <Tag :value="label" />
    <span class="text-sm text-slate-400">
      {{ detail }}
    </span>
  </div>
</template>
