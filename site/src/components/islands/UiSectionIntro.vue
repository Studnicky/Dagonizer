<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'start' | 'between';
}>();
</script>

<template>
  <div
    :class="[
      'flex flex-col gap-4 md:gap-5',
      align === 'between' ? 'md:flex-row md:items-end md:justify-between md:gap-8' : ''
    ]"
  >
    <div class="max-w-3xl space-y-3">
      <p class="text-xs uppercase tracking-[0.28em] text-slate-500">{{ eyebrow }}</p>
      <h2 class="text-3xl font-semibold tracking-tight text-white md:text-4xl">{{ title }}</h2>
      <p v-if="description" class="text-base leading-7 text-slate-300 md:text-lg">{{ description }}</p>
    </div>

    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap gap-3">
      <slot name="actions" />
    </div>
  </div>
</template>
