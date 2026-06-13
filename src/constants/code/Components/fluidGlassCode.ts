import code from '@content/Components/FluidGlass/FluidGlass.vue?raw';
import { createCodeObject } from '../../../types/code';

export const fluidGlass = createCodeObject(code, 'Components/FluidGlass', {
  installation: `npm install three
# Copy the lens.glb, bar.glb, cube.glb models into public/assets/3d/`,
  usage: `<template>
  <div class="h-[500px]">
    <FluidGlass
      mode="lens"
      :lens-props="{
        scale: 0.25,
        ior: 1.15,
        thickness: 5,
        chromaticAberration: 0.1,
        anisotropy: 0.01
      }"
    />
  </div>
</template>

<script setup lang="ts">
import FluidGlass from './FluidGlass.vue';
</script>`
});
