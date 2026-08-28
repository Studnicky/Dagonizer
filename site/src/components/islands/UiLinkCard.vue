<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  href: string;
  eyebrow?: string;
  meta?: string;
  title: string;
  body: string;
}>();
</script>

<template>
  <a :href="href" class="group block">
    <Card class="h-full transition hover:border-cyan-300/30 hover:bg-slate-900/80">
      <template #title>
        <div class="space-y-3">
          <div v-if="eyebrow || meta" class="flex items-center justify-between gap-4">
            <p v-if="eyebrow" class="text-xs uppercase tracking-[0.24em] text-slate-500">{{ eyebrow }}</p>
            <span v-if="meta" class="text-xs text-slate-500">{{ meta }}</span>
          </div>
          <h3 class="text-lg font-semibold text-white transition group-hover:text-cyan-100">{{ title }}</h3>
        </div>
      </template>
      <template #content>
        <p class="text-sm leading-6 text-slate-300">{{ body }}</p>
      </template>
    </Card>
  </a>
</template>
