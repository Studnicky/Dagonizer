<script setup lang="ts">
import Tag from 'primevue/tag';

defineProps<{
  items: readonly string[];
  tone?: 'default' | 'cyan';
}>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Tag
      v-for="item in items"
      :key="item"
      :value="item"
      :class="
        tone === 'cyan'
          ? '!border-cyan-400/25 !bg-cyan-400/10 !text-cyan-100'
          : '!border-white/10 !bg-white/4 !text-slate-400'
      "
    />
  </div>
</template>
