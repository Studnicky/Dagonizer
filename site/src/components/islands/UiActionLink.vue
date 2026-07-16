<script setup lang="ts">
import { computed, useSlots } from 'vue';
import Button from 'primevue/button';

const props = withDefaults(
  defineProps<{
    href: string;
    variant?: 'primary' | 'secondary' | 'text';
    block?: boolean;
    target?: string;
    rel?: string;
    className?: string;
    label?: string;
  }>(),
  {
    variant: 'secondary',
    block: false,
    target: undefined,
    rel: undefined,
    className: '',
    label: undefined
  }
);

const slots = useSlots();

const buttonProps = computed(() => {
  if (props.variant === 'text') {
    return {
      text: true,
      severity: undefined,
      variant: undefined
    };
  }

  if (props.variant === 'secondary') {
    return {
      text: false,
      severity: 'contrast',
      variant: 'outlined' as const
    };
  }

  return {
    text: false,
    severity: undefined,
    variant: undefined
  };
});

const rootClass = computed(() => [props.block ? 'w-full' : '', props.className].filter(Boolean).join(' '));

const hasSlotContent = computed(() => slots.default !== undefined);
</script>

<template>
  <Button
    as="a"
    :href="href"
    :target="target"
    :rel="rel"
    :label="hasSlotContent ? undefined : label"
    :text="buttonProps.text"
    :severity="buttonProps.severity"
    :variant="buttonProps.variant"
    :class="rootClass"
  >
    <slot />
  </Button>
</template>
