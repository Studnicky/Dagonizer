<script setup lang="ts">
withDefaults(
  defineProps<{
    items: readonly string[];
    tone?: 'default' | 'cyan';
  }>(),
  {
    tone: 'default'
  }
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
    <span
      v-for="(item, index) in items"
      :key="item"
      :class="[
        'inline-flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em]',
        tone === 'cyan' ? 'text-cyan-100' : 'text-slate-500'
      ]"
    >
      <span v-if="index > 0" aria-hidden="true" class="h-1 w-1 rounded-full bg-white/16"></span>
      <span>{{ item }}</span>
    </span>
  </div>
</template>
