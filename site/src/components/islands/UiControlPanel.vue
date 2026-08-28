<script setup lang="ts">
import Card from 'primevue/card';
</script>

<template>
  <Card>
    <template #content>
      <div class="grid gap-4 md:grid-cols-[1fr_15rem] lg:grid-cols-[1fr_16rem_15rem]">
        <slot />
      </div>
    </template>
  </Card>
</template>
