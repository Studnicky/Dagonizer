<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  title?: string;
  subtitle?: string;
}>();
</script>

<template>
  <Card class="h-full">
    <template v-if="title || subtitle" #title>
      <div class="space-y-1 border-b border-white/8 pb-4">
        <p v-if="subtitle" class="text-xs uppercase tracking-[0.24em] text-slate-500">{{ subtitle }}</p>
        <h3 v-if="title" class="text-lg font-semibold text-white">{{ title }}</h3>
      </div>
    </template>
    <template #content>
      <div :class="title || subtitle ? 'pt-0' : ''">
        <slot />
      </div>
    </template>
  </Card>
</template>
