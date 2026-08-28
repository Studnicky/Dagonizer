<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  title: string;
  eyebrow?: string;
  compact?: boolean;
}>();
</script>

<template>
  <Card class="h-full">
    <template #title>
      <div class="space-y-2">
        <p v-if="eyebrow" class="text-xs uppercase tracking-[0.24em] text-slate-500">{{ eyebrow }}</p>
        <h3 class="text-base font-semibold text-white">{{ title }}</h3>
      </div>
    </template>
    <template #content>
      <div :class="compact ? 'text-sm leading-6 text-slate-300' : 'space-y-3 text-sm leading-6 text-slate-300'">
        <slot />
      </div>
    </template>
  </Card>
</template>
