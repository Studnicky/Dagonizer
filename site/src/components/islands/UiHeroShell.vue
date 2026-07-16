<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  eyebrow?: string;
  title: string;
  description: string;
}>();
</script>

<template>
  <Card class="relative overflow-hidden rounded-[2rem]">
    <template #content>
      <section class="relative px-6 py-8 md:px-10 md:py-10">
        <div class="absolute inset-y-0 right-0 hidden w-[44%] md:block">
          <slot name="visual" />
        </div>

        <div class="relative grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)] xl:items-start">
          <div class="max-w-2xl space-y-6">
            <div v-if="eyebrow || $slots.eyebrow" class="flex flex-wrap items-center gap-3">
              <slot name="eyebrow">
                <span class="text-xs uppercase tracking-[0.28em] text-slate-500">{{ eyebrow }}</span>
              </slot>
            </div>

            <div class="space-y-4">
              <h1 class="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                {{ title }}
              </h1>
              <p class="max-w-xl text-base leading-7 text-slate-300 md:text-lg">
                {{ description }}
              </p>
            </div>

            <div v-if="$slots.actions" class="flex flex-wrap gap-3">
              <slot name="actions" />
            </div>

            <div v-if="$slots.supporting" class="pt-2">
              <slot name="supporting" />
            </div>
          </div>

          <div class="relative hidden min-h-[26rem] xl:block">
            <slot name="visual" />
          </div>
        </div>
      </section>
    </template>
  </Card>
</template>
