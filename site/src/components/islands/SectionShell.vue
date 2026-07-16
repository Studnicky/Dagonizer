<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  eyebrow: string;
  title: string;
  description: string;
}>();
</script>

<template>
  <Card>
    <template #content>
      <section>
        <div class="max-w-3xl space-y-3">
          <p class="text-xs uppercase tracking-[0.28em] text-slate-500">{{ eyebrow }}</p>
          <h1 class="text-3xl font-semibold tracking-tight text-white md:text-5xl">{{ title }}</h1>
          <p class="text-base leading-7 text-slate-300 md:text-lg">{{ description }}</p>
        </div>
        <div class="mt-8">
          <slot />
        </div>
      </section>
    </template>
  </Card>
</template>
