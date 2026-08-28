<script setup lang="ts">
defineProps<{
  align?: 'start' | 'between';
  wrap?: boolean;
}>();
</script>

<template>
  <div
    :class="[
      'flex items-center gap-3',
      wrap === false ? 'flex-nowrap' : 'flex-wrap',
      align === 'between' ? 'w-full justify-between' : 'justify-start'
    ]"
  >
    <slot />
  </div>
</template>
